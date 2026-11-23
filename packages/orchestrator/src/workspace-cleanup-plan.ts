import { randomBytes } from "node:crypto";

import {
  evaluateWorkspaceCleanup,
  listAssignments,
  listWorkspaceIntegrationAttempts,
  readWorkspace,
  type WorkspaceCleanupObservation,
} from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import {
  WorkspaceHostError,
  type WorkspaceCleanupHostAdapter,
  type WorkspaceCleanupHostInspection,
  type WorkspaceOwnershipMarker,
} from "@lervo/workspace-host";

import {
  workspaceCleanupDigest,
  type WorkspaceCleanupCoordinates,
  type WorkspaceCleanupEvidence,
  type WorkspaceCleanupPlan,
} from "./workspace-cleanup-contract.js";

function id(prefix: "evt" | "idk" | "wcj" | "wcp"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function markerFor(
  workspace: NonNullable<Awaited<ReturnType<typeof readWorkspace>>>["workspace"],
): WorkspaceOwnershipMarker {
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

export function pathPrivateWorkspaceCleanupEvidence(
  inspection: WorkspaceCleanupHostInspection,
): WorkspaceCleanupEvidence {
  if (
    inspection.status !== "present" ||
    inspection.headCommit === null ||
    inspection.treeHash === null ||
    inspection.clean === null ||
    inspection.gitOperationInProgress === null ||
    inspection.nativeInstanceDigest === null ||
    inspection.integrationTargetCommit === null ||
    inspection.headReachableFromTarget === null ||
    inspection.gitMetadataHash === null ||
    inspection.dependentReferenceCount === null ||
    inspection.childWorkspaceCount === null ||
    inspection.reviewLinkCount === null
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The cleanup host inspection is incomplete.",
    );
  const changedPaths = inspection.changedPaths ?? [];
  return {
    status: "present",
    headCommit: inspection.headCommit,
    treeHash: inspection.treeHash,
    clean: inspection.clean,
    gitOperationInProgress: inspection.gitOperationInProgress,
    markerMatched: inspection.markerMatched,
    processObservation: inspection.processObservation,
    nativeInstanceDigest: inspection.nativeInstanceDigest,
    integrationTargetCommit: inspection.integrationTargetCommit,
    headReachableFromTarget: inspection.headReachableFromTarget,
    gitMetadataHash: inspection.gitMetadataHash,
    dependentReferenceCount: inspection.dependentReferenceCount,
    childWorkspaceCount: inspection.childWorkspaceCount,
    reviewLinkCount: inspection.reviewLinkCount,
    changedPathSetDigest: workspaceCleanupDigest(changedPaths),
    changedPathCount: changedPaths.length,
  };
}

export async function planWorkspaceCleanup(input: {
  coordinates: WorkspaceCleanupCoordinates;
  workspaceId: string;
  host: WorkspaceCleanupHostAdapter;
  now?: Date;
}): Promise<WorkspaceCleanupPlan> {
  if (!input.host.capabilities.cleanupInspection || !input.host.capabilities.nonForceRemoval)
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The workspace host does not support exact cleanup.",
    );
  const stored = await readWorkspace(input.coordinates.repositoryRoot, input.workspaceId);
  if (
    stored === null ||
    !["integrated", "cleanup_eligible"].includes(stored.workspace.state) ||
    stored.workspace.sealedResult === null ||
    stored.workspace.integrationEvidenceId === null
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "Only an exact integrated workspace can be planned for cleanup.",
    );
  const workspace = stored.workspace;
  const sealedResult = workspace.sealedResult;
  const integrationEvidenceId = workspace.integrationEvidenceId;
  if (sealedResult === null || integrationEvidenceId === null)
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integrated workspace evidence disappeared during cleanup planning.",
    );
  const marker = markerFor(workspace);
  if (
    workspaceCleanupDigest(marker) !== workspace.markerHash ||
    workspace.pathDigest !== repositoryCoordinateDigest(input.coordinates.workspacePath) ||
    workspace.repositoryInstanceId.length === 0 ||
    workspace.host.kind !== input.host.kind ||
    workspace.host.version !== input.host.version
  )
    throw new WorkspaceHostError(
      "host_marker_mismatch",
      "The cleanup workspace coordinate differs from its ownership record.",
    );
  const assignment = (await listAssignments(input.coordinates.repositoryRoot)).find(
    (item) => item.assignmentId === workspace.assignmentId,
  );
  if (assignment === undefined)
    throw new WorkspaceHostError("host_effect_uncertain", "The cleanup assignment is absent.");
  const attempts = await listWorkspaceIntegrationAttempts(input.coordinates.repositoryRoot);
  const exactAttempt = attempts.find(
    (attempt) =>
      attempt.attemptId === integrationEvidenceId &&
      ((workspace.executionKind === "integrator" &&
        attempt.integratorWorkspaceId === workspace.workspaceId &&
        attempt.integratorWorkspaceGeneration === workspace.generation) ||
        attempt.sources.some(
          (source) =>
            source.workspaceId === workspace.workspaceId &&
            source.generation === workspace.generation,
        )),
  );
  const transactionAbsent =
    exactAttempt?.state === "integrated" &&
    !attempts.some(
      (attempt) =>
        attempt.attemptId !== exactAttempt.attemptId &&
        attempt.sources.some(
          (source) =>
            source.workspaceId === workspace.workspaceId &&
            source.generation === workspace.generation,
        ) &&
        !["integrated", "conflict", "released"].includes(attempt.state),
    );
  const rawInspection = await input.host.inspectCleanup({
    repositoryRoot: input.coordinates.repositoryRoot,
    workspacePath: input.coordinates.workspacePath,
    baseCommit: workspace.baseCommit,
    marker,
    integrationTargetRef: input.coordinates.integrationTargetRef,
    integratedHeadCommit: sealedResult.headCommit,
  });
  const hostEvidence = pathPrivateWorkspaceCleanupEvidence(rawInspection);
  const lervoWriterClosure =
    input.host.kind === "git" &&
    hostEvidence.processObservation === "unavailable" &&
    workspace.writerSession === null &&
    assignment.lease === null &&
    transactionAbsent;
  const quiescenceSource =
    hostEvidence.processObservation === "quiescent"
      ? ("host_process" as const)
      : lervoWriterClosure
        ? ("lervo_writer_closure" as const)
        : ("unproven" as const);
  const observation: WorkspaceCleanupObservation = {
    owned: hostEvidence.markerMatched,
    stateIntegrated: true,
    sealedBytesMatch:
      hostEvidence.headCommit === sealedResult.headCommit &&
      hostEvidence.treeHash === sealedResult.treeHash &&
      hostEvidence.changedPathSetDigest === sealedResult.changedPathSetDigest &&
      hostEvidence.changedPathCount === sealedResult.changedPathCount,
    checkoutClean: hostEvidence.clean,
    headReachable: hostEvidence.headReachableFromTarget,
    leaseAbsent: assignment.lease === null,
    writerAbsent: workspace.writerSession === null,
    terminalAbsent: hostEvidence.processObservation === "quiescent" || lervoWriterClosure,
    childWorkspaceAbsent: hostEvidence.childWorkspaceCount === 0,
    gitOperationAbsent: !hostEvidence.gitOperationInProgress,
    reviewLinkAbsent: hostEvidence.reviewLinkCount === 0,
    transactionAbsent,
    approvalAbsent: !sealedResult.approvalPending,
    recoveryMarkerAbsent: workspace.recoveryReason === null,
    markerMatched: hostEvidence.markerMatched,
    repositoryMatched: true,
    adapterMatched:
      workspace.host.kind === input.host.kind &&
      workspace.host.version === input.host.version &&
      workspace.host.nativeInstanceDigest === hostEvidence.nativeInstanceDigest,
    pathMatched:
      workspace.pathDigest === repositoryCoordinateDigest(input.coordinates.workspacePath),
    quiescenceProven: quiescenceSource !== "unproven",
    nonForceRemovalSupported: input.host.capabilities.nonForceRemoval,
  };
  const decision = evaluateWorkspaceCleanup(observation);
  const createdAt = (input.now ?? new Date()).toISOString();
  const content = {
    schemaVersion: 1 as const,
    planKind: "workspace_cleanup" as const,
    planId: id("wcp"),
    status: decision.eligible ? ("ready" as const) : ("blocked" as const),
    createdAt,
    repositoryRootDigest: repositoryCoordinateDigest(input.coordinates.repositoryRoot),
    workspacePathDigest: workspace.pathDigest,
    integrationTargetDigest: repositoryCoordinateDigest(input.coordinates.integrationTargetRef),
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.generation,
    workspaceRevision: workspace.revision,
    workspaceContentHash: stored.contentHash,
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.revision,
    repositoryInstanceId: workspace.repositoryInstanceId,
    hostKind: workspace.host.kind,
    hostVersion: workspace.host.version,
    marker,
    workspaceBaseCommit: workspace.baseCommit,
    sealedHeadCommit: sealedResult.headCommit,
    sealedTreeHash: sealedResult.treeHash,
    integrationEvidenceId,
    integrationTargetCommit: hostEvidence.integrationTargetCommit,
    hostEvidence,
    observation,
    blockedReasons: decision.reasons,
    quiescenceSource,
    operation: "remove_workspace_non_force" as const,
    journalId: id("wcj"),
    eligibleEventId: id("evt"),
    removingEventId: id("evt"),
    removedEventId: id("evt"),
    resetEventId: id("evt"),
    recoveryEventId: id("evt"),
    idempotencyKey: id("idk"),
  };
  return { ...content, contentHash: workspaceCleanupDigest(content) };
}
