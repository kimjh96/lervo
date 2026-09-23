import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
  WorkResponsibilityV1,
} from "@lervo/application-contract";
import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import { resolveRoleContract } from "@lervo/roles";
import { operatingContractHash, workerReadinessKinds } from "@lervo/work-controller";
import { readSupervisionAssignmentSource } from "./supervision-assignment-source.js";
import { readSupervisionWorkspaceSource } from "./supervision-workspace-source.js";
import { loadSupervisionPlanningContext } from "./supervision-planning-context.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { observeSupervisionResearchReadiness } from "./supervision-research-policy.js";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { writingContractForLanguage } from "@lervo/core";
import type { ProjectStorage } from "@lervo/project-storage";

/** Actual task permissions and available context seed the subsequent mandatory runtime probes. */
export async function prepareCanonicalSupervisionReadiness(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  responsibility: WorkResponsibilityV1;
  workstreamRevision: number;
  admission: OperatingAdmissionSnapshotV1;
  aggregateBudgetRequired: boolean;
  configuration: NodeRuntimeReadinessConfiguration | undefined;
  now(): string;
  workspaceEvidenceStorage?: ProjectStorage;
}): Promise<Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>> {
  const { plan, responsibility: task, admission, configuration } = input;
  if (!["work.managed_execution.v1", "work.managed_execution.v2"].includes(plan.effectContract))
    throw new Error(
      "The canonical managed readiness has no reviewed tool mapping for this effect.",
    );
  const unmappedCapability = task.requiredCapabilities.some(
    (capability) => !["filesystem.read", "filesystem.write", "shell.execute"].includes(capability),
  );
  const context = await loadSupervisionPlanningContext({
    repositoryRoot: input.repositoryRoot,
    projectId: plan.projectId,
    workstreamId: plan.workstreamId,
    workstreamRevision: input.workstreamRevision,
    purpose: task.taskPurpose,
    expectedPaths: task.expectedPaths,
    now: input.now,
  });
  const observedAt = context.observedAt;
  const workforce = await readSupervisionAssignmentSource({ ...input, now: observedAt });
  const role = await resolveRoleContract(input.repositoryRoot, task.roleId);
  if (role.contractHash !== task.roleContractHash)
    throw new Error("The canonical readiness role changed.");
  const shellRequired = task.requiredCapabilities.includes("shell.execute");
  const shellAuthorized = role.definition.profile.capabilities["shell.execute"] === "allow";
  const sourcePolicyRequired =
    role.definition.profile.contextPolicy.requiredDocumentRuleIds.includes(
      "research.source-policy",
    );
  const research = sourcePolicyRequired
    ? await observeSupervisionResearchReadiness({
        ...input,
        projectId: plan.projectId,
        role: role.definition.profile,
      })
    : null;
  const knowledgePolicy = await loadRepositoryKnowledgePolicy(input.repositoryRoot);
  const writing = writingContractForLanguage(knowledgePolicy.publication.language);
  const contextRulesMapped = role.definition.profile.contextPolicy.requiredDocumentRuleIds.every(
    (rule) =>
      rule === "repository.instructions" ||
      (rule === "research.source-policy" && research?.status === "passed") ||
      (rule === "writing.policy" &&
        role.definition.profile.outputContract.presentation.writingPolicyId ===
          writing.writingPolicyId),
  );
  const workspace = await readSupervisionWorkspaceSource(
    input.repositoryRoot,
    workforce.assignment,
    plan,
    input.workspaceEvidenceStorage,
  );
  const permissionHash = operatingContractHash({
    ancestry: workforce.ancestryHash,
    responsibility: task,
    managedToolContract: "work.managed_execution.v1",
    configuration: configuration ?? null,
  });
  const evidence = {
    provider: permissionHash,
    tools: permissionHash,
    cli: operatingContractHash({
      permissionHash,
      roleContractHash: role.contractHash,
      shellAuthorized,
    }),
    read_scope: permissionHash,
    write_scope: permissionHash,
    knowledge: operatingContractHash({ contextHash: context.contextHash, writing, research }),
    verification: permissionHash,
    budget: operatingContractHash({
      admission,
      aggregateBudgetRequired: input.aggregateBudgetRequired,
      mandateHash: plan.mandateHash,
    }),
    workspace: workspace.evidenceHash,
    ancestry: workforce.ancestryHash,
    lease: workforce.leaseHash,
  };
  return {
    responsibility: structuredClone(task),
    requiredChecks: sourcePolicyRequired ? ["source_policy"] : [],
    observation: {
      schemaVersion: 1,
      sourceRevisionDigest: admission.sourceRevisionDigest,
      responsibilityArtifactHash: operatingContractHash(task),
      agentId: task.executorAgentId,
      roleId: task.roleId,
      roleVersion: task.roleVersion,
      roleContractHash: task.roleContractHash,
      observedAt,
      validUntil: new Date(Date.parse(observedAt) + 30_000).toISOString(),
      checks: workerReadinessKinds.map((kind) => {
        if (kind === "source_policy" && research !== null) return research;
        if (
          kind === "source_policy" ||
          (kind === "cli" && !shellRequired) ||
          (kind === "write_scope" && !task.requiredCapabilities.includes("filesystem.write"))
        )
          return { kind, status: "not_required" as const, evidenceHash: null };
        if (
          (kind === "budget" &&
            input.aggregateBudgetRequired &&
            admission.resourceAdmission !== "within") ||
          (kind === "knowledge" && !contextRulesMapped) ||
          (kind === "cli" && (!shellAuthorized || configuration === undefined)) ||
          (["provider", "tools", "verification"].includes(kind) && configuration === undefined) ||
          (kind === "tools" && unmappedCapability)
        )
          return { kind, status: "unobserved" as const, evidenceHash: null };
        return { kind, status: "passed" as const, evidenceHash: evidence[kind] };
      }),
    },
  };
}
