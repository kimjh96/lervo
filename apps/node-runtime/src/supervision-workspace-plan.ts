import { currentSupervisionWorkspaces } from "./supervision-workspace-generations.js";
import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  OperatingActionPlanV1,
  SupervisedWorkspacePreparationV1,
} from "@lervo/application-contract";
import { type WorkspaceProvisionPlan } from "@lervo/orchestrator";
import {
  repositoryCoordinateDigest,
  resolveRepositoryCoordinationHome,
  type ProjectStorage,
} from "@lervo/project-storage";
import {
  operatingContractHash,
  supervisedWorkspacePreparationFields,
} from "@lervo/work-controller";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

/** Host paths are trusted configuration; model decisions cannot choose a workspace location. */
export async function assertSupervisionWorkspaceLocation(
  root: string,
  provision: WorkspaceProvisionPlan,
  configuration: NonNullable<NodeRuntimeReadinessConfiguration["workerWorkspace"]>,
) {
  const parent = configuration.parentDirectory;
  const info = await lstat(parent);
  const canonicalParent = await realpath(parent);
  const canonicalRoot = await realpath(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    canonicalParent !== resolve(parent) ||
    canonicalParent === canonicalRoot ||
    canonicalParent.startsWith(`${canonicalRoot}/`) ||
    dirname(provision.workspacePath) !== canonicalParent ||
    provision.workspacePath !== resolve(parent, provision.workspace.workspaceId) ||
    provision.baseCommit !== configuration.baseCommit ||
    provision.workspace.integrationTargetDigest !== configuration.integrationTargetDigest
  )
    throw new Error("The workspace plan differs from its configured host coordinate.");
}

export async function readSupervisionWorkspacePlan(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedWorkspacePreparationV1;
  const fields = supervisedWorkspacePreparationFields(effect);
  const provision = (await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.provisionPlanHash,
  )) as WorkspaceProvisionPlan;
  const { contentHash, ...content } = provision;
  const task = effect.responsibility;
  const host = new GitWorkspaceHostAdapter();
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    ) ||
    provision.schemaVersion !== 1 ||
    provision.planKind !== "workspace_provision" ||
    operatingContractHash(content) !== contentHash ||
    provision.repositoryRoot !== storage.paths.repositoryRoot ||
    provision.assignmentId !== task.assignmentId ||
    provision.assignmentRevision !== task.assignmentRevision ||
    provision.agentId !== task.executorAgentId ||
    provision.provider !== effect.provider ||
    provision.workspace.executionKind !== "worker" ||
    provision.workspace.assignmentId !== task.assignmentId ||
    provision.workspace.agentId !== task.executorAgentId ||
    provision.workspace.host.kind !== host.kind ||
    provision.workspace.host.version !== host.version ||
    !/^wpl_[a-f0-9]{24}$/u.test(provision.planId) ||
    !/^idk_[a-f0-9]{24}$/u.test(provision.idempotencyKey) ||
    !/^wsp_[a-f0-9]{24}$/u.test(provision.workspace.workspaceId) ||
    ![provision.provisionEventId, provision.readyEventId, provision.recoveryEventId].every((id) =>
      /^evt_[a-f0-9]{24}$/u.test(id),
    ) ||
    new Set([provision.provisionEventId, provision.readyEventId, provision.recoveryEventId])
      .size !== 3 ||
    provision.workspace.schemaVersion !== 1 ||
    provision.workspace.generation !== 1 ||
    provision.workspace.revision !== 1 ||
    provision.workspace.projectId !== plan.projectId ||
    provision.workspace.leaseGeneration !== provision.leaseGeneration ||
    provision.workspace.baseCommit !== provision.baseCommit ||
    provision.workspace.creationPlanId !== provision.planId ||
    provision.workspace.host.nativeInstanceDigest !== null ||
    provision.workspace.writerSession !== null ||
    provision.workspace.recoveryReason !== null ||
    provision.workspace.createdAt !== provision.createdAt ||
    provision.workspace.updatedAt !== provision.createdAt ||
    !Number.isFinite(Date.parse(provision.createdAt)) ||
    provision.workspace.pathDigest !== repositoryCoordinateDigest(provision.workspacePath) ||
    provision.workspace.markerHash !== operatingContractHash(provision.marker) ||
    operatingContractHash(provision.marker) !==
      operatingContractHash({
        schemaVersion: 1,
        workspaceId: provision.workspace.workspaceId,
        generation: 1,
        repositoryInstanceId: provision.workspace.repositoryInstanceId,
        adapterKind: host.kind,
        adapterVersion: host.version,
        creationPlanId: provision.planId,
        pathDigest: provision.workspace.pathDigest,
      }) ||
    provision.workspace.state !== "provisioning" ||
    provision.workspace.ownerWorkspacePath !== provision.workspacePath
  )
    throw new Error(
      "The workspace preparation differs from its exact responsibility and host plan.",
    );
  const rationale = await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.rationaleArtifactHash,
  );
  if (typeof rationale !== "string" || !rationale.trim())
    throw new Error("The workspace rationale is unavailable.");
  return { effect, fields, provision };
}

export async function readCanonicalWorkspacePreparation(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  plan: OperatingActionPlanV1;
  now(): string;
}) {
  const basis = await readSupervisionWorkspacePlan(input.storage, input.plan);
  const task = basis.effect.responsibility;
  const assignment = input.source.assignments.find(
    (item) => item.assignmentId === task.assignmentId,
  );
  const binding = input.source.responsibilities.find(
    (item) => item.assignmentId === task.assignmentId,
  )?.binding;
  const home = await resolveRepositoryCoordinationHome(input.storage.paths.repositoryRoot);
  const workspaces =
    assignment === undefined
      ? []
      : await currentSupervisionWorkspaces(
          input.storage.paths.repositoryRoot,
          assignment,
          input.plan,
          input.storage,
        );
  if (
    basis.provision.workspace.repositoryInstanceId !== home.repositoryInstanceId ||
    input.source.workstream.status !== "active" ||
    assignment?.revision !== task.assignmentRevision ||
    assignment.assigneeAgentId !== task.executorAgentId ||
    assignment.lease?.leaseId !== basis.provision.leaseId ||
    assignment.lease.generation !== basis.provision.leaseGeneration ||
    Date.parse(assignment.lease.expiresAt) <= Date.parse(input.now()) ||
    Date.parse(task.startDeadline) <= Date.parse(input.now()) ||
    binding?.responsibilityHash !== basis.fields.responsibilityArtifactHash ||
    workspaces.some((item) => item.workspaceId !== basis.provision.workspace.workspaceId) ||
    workspaces.length > 1
  )
    throw new Error("The workspace preparation responsibility or lease changed.");
  return { ...basis, assignment };
}
