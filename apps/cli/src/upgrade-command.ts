import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";
import { applyWorkforceRoleBindingMigration } from "@lervo/agent-workforce";
import { loadProjectManifest } from "@lervo/project";
import { writeCommandError } from "./command-error-output.js";
import { applyTerminalIntegrationStage } from "./terminal-integration-stage.js";
import type { CliIo } from "./types.js";
import { formatUpgradePlan, formatUpgradeReceipt, type UpgradeReceipt } from "./upgrade-format.js";
import {
  applyRegisteredNodeUpgrade,
  inspectRegisteredNodeUpgrade,
  type NodeUpgradeStage,
} from "./upgrade-node.js";
import {
  applyKnowledgeStage,
  inspectKnowledge,
  inspectTerminalIntegration,
  inspectWorkforce,
  lintKnowledge,
  type KnowledgeStage,
  type TerminalIntegrationStage,
  type UpgradeStageBlocker,
  type WorkforceStage,
} from "./upgrade-stage-inspection.js";
import {
  applicableUpgradeStages,
  deferralReason,
  deferringPrerequisite,
  overallUpgradeStatus,
  upgradeStageDependencies,
  type StageDisposition,
  type UpgradeStageName,
} from "./upgrade-stage-policy.js";
import { readCliPackageVersion } from "./version-command.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

export const upgradeUsage =
  "  lervo upgrade [--root <path>] [--apply --approval <plan-id> [--approve-role-binding <operation-id>=<sha256> ...]] [--json]";

export interface RepositoryUpgradePlan {
  schemaVersion: 1;
  planKind: "repository_upgrade";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  status: "ready" | "current" | "pending_authority" | "blocked";
  /** Stages an exact apply of this plan changes, even when another stage is blocked. */
  applicableStages: UpgradeStageName[];
  cli: { version: string; buildHash: string; acquisition: "outside_repository_upgrade" };
  policy: {
    generatedOnlyAutomaticApply: true;
    maximumKnowledgeStages: 16;
    userOwnedBytes: "exact_approval_required";
    providerConfiguration: "exact_approval_required";
    nodeService: "registered_instance_transactional_reconciliation";
    stageDependencies: typeof upgradeStageDependencies;
  };
  stages: {
    capabilities: {
      disposition: StageDisposition;
      planId: string;
      createCount: number;
      observedProviderSurfaceCount: number;
    };
    workforce: WorkforceStage;
    terminalIntegration: TerminalIntegrationStage;
    knowledge: KnowledgeStage;
    node: Omit<NodeUpgradeStage, "disposition"> & { disposition: StageDisposition };
  };
  privacy: {
    scope: "local_plan_and_receipt";
    credentials: "excluded";
    providerContent: "excluded";
    absolutePaths: "repository_root_only";
  };
  failureMeaning: string;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function planIdentifier(value: unknown): string {
  return `upg_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

async function cliBuildHash(): Promise<string> {
  return sha256(await readFile(fileURLToPath(import.meta.url)));
}

function deferredWorkforce(reason: string): WorkforceStage {
  return {
    disposition: "deferred",
    planId: null,
    staleAgentCount: 0,
    staleAssignmentCount: 0,
    status: "deferred",
    reason,
    requiredApprovals: [],
  };
}

function deferredKnowledge(reason: string): KnowledgeStage {
  return {
    disposition: "deferred",
    planKind: "knowledge_migration",
    planId: null,
    status: "deferred",
    reason,
    blockers: [],
  };
}

export async function createRepositoryUpgradePlan(root: string): Promise<RepositoryUpgradePlan> {
  const repositoryRoot = await realpath(resolve(root));
  const project = await loadProjectManifest(repositoryRoot);
  const version = readCliPackageVersion();
  const capabilities = await createCapabilityMigrationPlan(repositoryRoot);
  const capabilityDisposition: StageDisposition =
    capabilities.status === "ready" ? "safe_apply" : "current";
  const capabilityGate = { capabilities: capabilityDisposition };
  const workforceDeferral = deferringPrerequisite("workforce", capabilityGate);
  const knowledgeDeferral = deferringPrerequisite("knowledge", capabilityGate);
  const [buildHash, workforce, terminal, knowledge, node] = await Promise.all([
    cliBuildHash(),
    workforceDeferral === null
      ? inspectWorkforce(repositoryRoot)
      : Promise.resolve(deferredWorkforce(deferralReason(workforceDeferral))),
    inspectTerminalIntegration(repositoryRoot),
    knowledgeDeferral === null
      ? inspectKnowledge(repositoryRoot)
      : Promise.resolve(deferredKnowledge(deferralReason(knowledgeDeferral))),
    inspectRegisteredNodeUpgrade(repositoryRoot, project.projectId, version),
  ]);
  const nodeDeferral = deferringPrerequisite("node", { knowledge: knowledge.disposition });
  const nodeStage: RepositoryUpgradePlan["stages"]["node"] =
    nodeDeferral === null || node.stage.disposition !== "safe_apply"
      ? node.stage
      : { ...node.stage, disposition: "deferred", reason: deferralReason(nodeDeferral) };
  const dispositions: Record<UpgradeStageName, StageDisposition> = {
    capabilities: capabilityDisposition,
    workforce: workforce.disposition,
    terminal_integration: terminal.stage.disposition,
    knowledge: knowledge.disposition,
    node: nodeStage.disposition,
  };
  const body = {
    schemaVersion: 1 as const,
    planKind: "repository_upgrade" as const,
    repositoryRoot,
    projectId: project.projectId,
    status: overallUpgradeStatus(Object.values(dispositions)),
    applicableStages: applicableUpgradeStages(dispositions, workforce.requiredApprovals.length > 0),
    cli: { version, buildHash, acquisition: "outside_repository_upgrade" as const },
    policy: {
      generatedOnlyAutomaticApply: true as const,
      maximumKnowledgeStages: 16 as const,
      userOwnedBytes: "exact_approval_required" as const,
      providerConfiguration: "exact_approval_required" as const,
      nodeService: "registered_instance_transactional_reconciliation" as const,
      stageDependencies: upgradeStageDependencies,
    },
    stages: {
      capabilities: {
        disposition: capabilityDisposition,
        planId: capabilities.planId,
        createCount: capabilities.items.filter((item) => item.action === "create").length,
        observedProviderSurfaceCount: capabilities.observedProviderSurfaces.length,
      },
      workforce,
      terminalIntegration: terminal.stage,
      knowledge,
      node: nodeStage,
    },
    privacy: {
      scope: "local_plan_and_receipt" as const,
      credentials: "excluded" as const,
      providerContent: "excluded" as const,
      absolutePaths: "repository_root_only" as const,
    },
    failureMeaning:
      "A non-current stage is not proof of migration, provider activation, Node readiness, or CLI acquisition. A blocked stage does not prevent applying independent generated-only stages.",
  };
  return { ...body, planId: planIdentifier(body) };
}

function parseRoleBindingApprovals(
  values: string[] | undefined,
): Array<{ operationId: string; approvalHash: string }> {
  return (values ?? []).map((value) => {
    const match = /^(wrbop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(value);
    if (match === null)
      throw new Error("--approve-role-binding must use <operation-id>=<sha256-approval-hash>.");
    return { operationId: match[1]!, approvalHash: match[2]! };
  });
}

function pendingStages(plan: RepositoryUpgradePlan): UpgradeReceipt["pending"] {
  const stages: Array<{
    stage: UpgradeStageName;
    disposition: StageDisposition;
    reason: string;
    blockers?: UpgradeStageBlocker[];
  }> = [
    {
      stage: "capabilities",
      disposition: plan.stages.capabilities.disposition,
      reason: "capability_migration_pending",
    },
    { stage: "workforce", ...plan.stages.workforce },
    { stage: "terminal_integration", ...plan.stages.terminalIntegration },
    { stage: "knowledge", ...plan.stages.knowledge },
    { stage: "node", ...plan.stages.node },
  ];
  return stages
    .filter((stage) => stage.disposition === "pending_authority" || stage.disposition === "blocked")
    .map((stage) => ({
      stage: stage.stage,
      disposition: stage.disposition,
      reason: stage.reason,
      blockers: stage.blockers ?? [],
    }));
}

async function applyRepositoryUpgrade(
  approved: RepositoryUpgradePlan,
  roleBindingApprovals: Array<{ operationId: string; approvalHash: string }>,
): Promise<UpgradeReceipt> {
  const root = approved.repositoryRoot;
  const appliedStages: string[] = [];
  const skippedStages: UpgradeReceipt["skippedStages"] = [];

  if (approved.stages.capabilities.disposition === "safe_apply") {
    const capabilityPlan = await createCapabilityMigrationPlan(root);
    if (capabilityPlan.planId !== approved.stages.capabilities.planId)
      throw new Error("The capability migration plan changed before apply.");
    await applyCapabilityMigration(capabilityPlan);
    appliedStages.push("capabilities");
  }

  const workforce = await inspectWorkforce(root);
  if (workforce.disposition === "blocked")
    skippedStages.push({ stage: "workforce", reason: workforce.reason });
  else if (
    workforce.disposition === "safe_apply" ||
    workforce.disposition === "pending_authority"
  ) {
    const migrated = await mutateWorkforceState(root, (recordEvent) =>
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        approval: workforce.planId!,
        approvedRoleBindings: roleBindingApprovals,
        recordEvent,
      }),
    );
    if (migrated.migratedAgentCount + migrated.migratedAssignmentCount > 0)
      appliedStages.push("workforce_role_bindings");
  }

  if (approved.stages.terminalIntegration.disposition === "safe_apply") {
    const terminal = await inspectTerminalIntegration(root);
    if (terminal.stage.planId !== approved.stages.terminalIntegration.planId)
      throw new Error("The terminal integration plan changed before apply.");
    await applyTerminalIntegrationStage({
      repositoryRoot: root,
      prepared: terminal.prepared,
      approval: null,
      now: new Date(),
    });
    appliedStages.push("terminal_integration");
  }

  for (let index = 0; index < approved.policy.maximumKnowledgeStages; index += 1) {
    const stage = await inspectKnowledge(root);
    if (stage.disposition !== "safe_apply") break;
    await applyKnowledgeStage(root, stage);
    appliedStages.push(stage.planKind);
    if (index === approved.policy.maximumKnowledgeStages - 1)
      throw new Error(
        "The bounded knowledge upgrade did not converge within 16 generated-only stages.",
      );
  }

  const postKnowledge = await inspectKnowledge(root);
  let lint: UpgradeReceipt["knowledgeLint"] = null;
  const nodeDeferral = deferringPrerequisite("node", { knowledge: postKnowledge.disposition });
  if (nodeDeferral !== null) {
    skippedStages.push({ stage: "knowledge_lint", reason: deferralReason(nodeDeferral) });
    skippedStages.push({ stage: "node", reason: deferralReason(nodeDeferral) });
  } else {
    lint = await lintKnowledge(root);
    const node = await inspectRegisteredNodeUpgrade(root, approved.projectId, approved.cli.version);
    if (node.stage.disposition === "safe_apply") {
      await applyRegisteredNodeUpgrade(node);
      appliedStages.push("repository_node");
    }
  }

  const final = await createRepositoryUpgradePlan(root);
  return {
    schemaVersion: 1,
    operation: "repository_upgrade",
    approvedPlanId: approved.planId,
    status: final.status,
    appliedStages,
    skippedStages,
    knowledgeLint: lint,
    nextPlanId: final.status === "current" ? null : final.planId,
    pending: pendingStages(final),
    cliAcquisition: "outside_repository_upgrade",
  };
}

export async function runUpgradeCommand(args: string[], io: CliIo): Promise<number> {
  let values: {
    root?: string;
    apply?: boolean;
    approval?: string;
    "approve-role-binding"?: string[];
    json?: boolean;
    help?: boolean;
  };
  try {
    values = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        apply: { type: "boolean" },
        approval: { type: "string" },
        "approve-role-binding": { type: "string", multiple: true },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${upgradeUsage}\n`);
    return 1;
  }
  if (values.help) {
    io.stdout(`${upgradeUsage}\n`);
    return 0;
  }
  if ((values.apply === true) !== (values.approval !== undefined)) {
    io.stderr(`Upgrade apply requires both --apply and --approval.\n${upgradeUsage}\n`);
    return 1;
  }
  if (values.apply !== true && (values["approve-role-binding"]?.length ?? 0) > 0) {
    io.stderr(`--approve-role-binding must be used with --apply.\n${upgradeUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, values.root ?? ".");
  try {
    const roleBindingApprovals = parseRoleBindingApprovals(values["approve-role-binding"]);
    const initial = await createRepositoryUpgradePlan(root);
    if (!values.apply) {
      io.stdout(values.json ? `${JSON.stringify(initial, null, 2)}\n` : formatUpgradePlan(initial));
      return initial.status === "blocked" ? 1 : 0;
    }
    if (values.approval !== initial.planId)
      throw new Error("--approval must equal the exact current repository upgrade plan ID.");
    if (initial.status === "blocked" && initial.applicableStages.length === 0)
      throw new Error(
        "The current repository upgrade plan is blocked and has no independent stage to apply.",
      );
    for (const approval of roleBindingApprovals) {
      if (
        !initial.stages.workforce.requiredApprovals.some(
          (required) =>
            required.operationId === approval.operationId &&
            required.approvalHash === approval.approvalHash,
        )
      )
        throw new Error("A workforce role-binding approval is not in the approved upgrade plan.");
    }
    const receipt = await applyRepositoryUpgrade(initial, roleBindingApprovals);
    io.stdout(
      values.json ? `${JSON.stringify(receipt, null, 2)}\n` : formatUpgradeReceipt(receipt),
    );
    return receipt.status === "blocked" ? 1 : 0;
  } catch (error) {
    writeCommandError(io, error, {
      json: values.json === true,
      prefix: `Repository upgrade failed${
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? ` (${error.code})`
          : ""
      }: `,
    });
    return 1;
  }
}
