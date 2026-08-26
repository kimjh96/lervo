import { randomBytes } from "node:crypto";

import {
  assertAssignmentExecutionAuthority,
  listAssignments,
  partitionWorkspaceChanges,
  readWorkspace,
  type AgentWorkspace,
  type WorkforceProvider,
  type WorkspaceIntegrationQueueEntry,
  type WorkspaceSealedResult,
  type WorkspaceVerificationResult,
  type WorkspaceWorkstreamBinding,
} from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import {
  WorkspaceHostError,
  type WorkspaceHostAdapter,
  type WorkspaceOwnershipMarker,
  type WorkspaceResultInspection,
} from "@lervo/workspace-host";

import {
  type WorkspaceSealPlan,
  workspaceSealDigest,
  workspaceSealPlanContent,
} from "./workspace-seal-contract.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{8,128}$/u;

function id(prefix: "evt" | "inq" | "wsl"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function markerFor(workspace: AgentWorkspace): WorkspaceOwnershipMarker {
  return {
    schemaVersion: 1,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    repositoryInstanceId: workspace.repositoryInstanceId,
    adapterKind: workspace.host.kind,
    adapterVersion: workspace.host.version,
    creationPlanId: workspace.creationPlanId,
    pathDigest: workspace.pathDigest,
  };
}

function validVerificationResults(results: WorkspaceVerificationResult[]): boolean {
  return (
    results.length <= 64 &&
    results.every(
      (result) =>
        /^[a-z][a-z0-9._-]{1,99}$/u.test(result.suiteId) &&
        HASH.test(result.policyHash) &&
        ARTIFACT_ID.test(result.resultArtifactId) &&
        HASH.test(result.resultArtifactHash) &&
        Number.isFinite(Date.parse(result.completedAt)) &&
        result.passed,
    )
  );
}

function assertSealableInspection(input: {
  workspace: AgentWorkspace;
  inspection: WorkspaceResultInspection;
  expectedPaths: string[];
  runtimeExcludedPaths: string[];
}): string[] {
  const { workspace, inspection } = input;
  const invalidEvidence = [
    ...(inspection.status === "present" ? [] : ["workspace_not_present"]),
    ...(inspection.markerMatched ? [] : ["marker_mismatch"]),
    ...(inspection.clean ? [] : ["checkout_not_clean"]),
    ...(inspection.gitOperationInProgress === false ? [] : ["git_operation_uncertain"]),
    ...(inspection.baseCommitReachable ? [] : ["base_not_reachable"]),
    ...(inspection.headCommit === null ? ["head_missing"] : []),
    ...(inspection.treeHash === null ? ["tree_missing"] : []),
    ...(inspection.changedPaths === null ? ["changed_paths_missing"] : []),
    ...(inspection.commitIds === null ? ["commits_missing"] : []),
    ...(inspection.nativeInstanceDigest === workspace.host.nativeInstanceDigest
      ? []
      : ["native_instance_mismatch"]),
  ];
  if (invalidEvidence.length > 0)
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      `The workspace does not have exact sealing evidence: ${invalidEvidence.join(", ")}.`,
    );
  const partition = partitionWorkspaceChanges({
    expectedPaths: input.expectedPaths,
    changedPaths: inspection.changedPaths!,
    runtimeExcludedPaths: input.runtimeExcludedPaths,
  });
  if (partition.outsideScope.length > 0 || partition.runtimeExcluded.length > 0)
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace result contains changes outside its assignment scope.",
    );
  return partition.expected;
}

export async function planWorkspaceSeal(input: {
  repositoryRoot: string;
  workspacePath: string;
  workspaceId: string;
  agentId: string;
  leaseId: string;
  provider: Exclude<WorkforceProvider, "any">;
  writerSessionId: string;
  resultArtifactId: string;
  resultArtifactHash: string;
  verificationResults: WorkspaceVerificationResult[];
  satisfiedApprovalRequirements?: string[];
  sourceWorkstream?: WorkspaceWorkstreamBinding | null;
  runtimeExcludedPaths?: string[];
  host: WorkspaceHostAdapter;
  now?: Date;
}): Promise<WorkspaceSealPlan> {
  const stored = await readWorkspace(input.repositoryRoot, input.workspaceId);
  const assignment = (await listAssignments(input.repositoryRoot)).find(
    (item) => item.assignmentId === stored?.workspace.assignmentId,
  );
  if (
    stored === null ||
    stored.workspace.state !== "active" ||
    stored.workspace.writerSession?.sessionId !== input.writerSessionId ||
    assignment === undefined ||
    assignment.lease === null ||
    assignment.lease.leaseId !== input.leaseId ||
    assignment.lease.generation !== stored.workspace.leaseGeneration ||
    stored.workspace.agentId !== input.agentId ||
    stored.workspace.pathDigest !== repositoryCoordinateDigest(input.workspacePath) ||
    input.host.kind !== stored.workspace.host.kind ||
    input.host.version !== stored.workspace.host.version
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace sealing coordinate is stale or unauthorized.",
    );
  await assertAssignmentExecutionAuthority({
    repositoryRoot: input.repositoryRoot,
    assignmentId: assignment.assignmentId,
    agentId: input.agentId,
    leaseId: input.leaseId,
    provider: input.provider,
    expectedPaths: assignment.expectedPaths,
    verificationSuiteIds: assignment.verificationSuiteIds,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const satisfied = new Set(input.satisfiedApprovalRequirements ?? []);
  if (assignment.approvalRequirements.some((requirement) => !satisfied.has(requirement)))
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace assignment still has an unsatisfied approval requirement.",
    );
  if (
    !ARTIFACT_ID.test(input.resultArtifactId) ||
    !HASH.test(input.resultArtifactHash) ||
    !validVerificationResults(input.verificationResults) ||
    assignment.verificationSuiteIds.some(
      (suiteId) => !input.verificationResults.some((result) => result.suiteId === suiteId),
    )
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace result or required verification evidence is invalid.",
    );
  const marker = markerFor(stored.workspace);
  if (workspaceSealDigest(marker) !== stored.workspace.markerHash)
    throw new WorkspaceHostError("host_marker_mismatch", "The workspace marker binding changed.");
  const inspection = await input.host.inspectResult({
    repositoryRoot: input.repositoryRoot,
    workspacePath: input.workspacePath,
    baseCommit: stored.workspace.baseCommit,
    marker,
  });
  const changedPaths = assertSealableInspection({
    workspace: stored.workspace,
    inspection,
    expectedPaths: assignment.expectedPaths,
    runtimeExcludedPaths: input.runtimeExcludedPaths ?? [".lervo/state"],
  });
  const createdAt = (input.now ?? new Date()).toISOString();
  const noChange = inspection.headCommit === stored.workspace.baseCommit;
  if (noChange !== (changedPaths.length === 0 && inspection.commitIds!.length === 0))
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The workspace no-change evidence is inconsistent.",
    );
  const sealedResult: WorkspaceSealedResult = {
    baseCommit: stored.workspace.baseCommit,
    headCommit: inspection.headCommit!,
    treeHash: inspection.treeHash!,
    changedPathSetDigest: workspaceSealDigest(changedPaths),
    changedPathCount: changedPaths.length,
    changedPaths,
    commitIds: inspection.commitIds!,
    resultArtifactId: input.resultArtifactId,
    resultArtifactHash: input.resultArtifactHash,
    verificationResults: [...input.verificationResults].sort((left, right) =>
      left.suiteId.localeCompare(right.suiteId),
    ),
    approvalPending: false,
    recoveryPending: false,
    sourceWorkstream: input.sourceWorkstream ?? null,
    noChange,
    sealedAt: createdAt,
  };
  const queueEntry: WorkspaceIntegrationQueueEntry = {
    schemaVersion: 1,
    queueEntryId: id("inq"),
    workspaceId: stored.workspace.workspaceId,
    generation: stored.workspace.generation,
    assignmentId: assignment.assignmentId,
    dependencyAssignmentIds: [...assignment.dependencyIds].sort(),
    priority: assignment.priority,
    headCommit: sealedResult.headCommit,
    treeHash: sealedResult.treeHash,
    changedPathSetDigest: sealedResult.changedPathSetDigest,
    changedPathCount: sealedResult.changedPathCount,
    sealedAt: sealedResult.sealedAt,
    queuedAt: createdAt,
  };
  const content = {
    schemaVersion: 1 as const,
    planKind: "workspace_seal" as const,
    planId: id("wsl"),
    createdAt,
    repositoryRoot: input.repositoryRoot,
    workspacePath: input.workspacePath,
    workspaceId: stored.workspace.workspaceId,
    workspaceContentHash: stored.contentHash,
    workspaceRevision: stored.workspace.revision,
    workspaceGeneration: stored.workspace.generation,
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.revision,
    agentId: input.agentId,
    leaseId: input.leaseId,
    leaseGeneration: assignment.lease.generation,
    provider: input.provider,
    writerSessionId: input.writerSessionId,
    expectedPaths: [...assignment.expectedPaths],
    marker,
    inspection,
    sealedResult,
    queueEntry,
    sealingEventId: id("evt"),
    sealedEventId: id("evt"),
    pendingEventId: id("evt"),
  };
  return { ...content, contentHash: workspaceSealPlanContent(content) };
}
