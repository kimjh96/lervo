import { repositoryPathWithinScope } from "@lervo/work-controller";
import { isAbsolute } from "node:path";

import { AgentWorkforceError } from "./types.js";
import type {
  AgentWorkspace,
  WorkspaceCleanupObservation,
  WorkspaceIntegrationCandidate,
  WorkspaceIntegrationQueueEntry,
  WorkspaceSealedResult,
  WorkspaceState,
  WorkspaceTransitionEvidence,
  WorkspaceWriterSession,
} from "./workspace-types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const WORKSPACE_ID = /^wsp_[a-f0-9]{24}$/u;
const REPOSITORY_INSTANCE_ID = /^rpi_[a-f0-9]{24}$/u;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{8,128}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0).{1,1024}$/u;

const transitions: Readonly<Record<WorkspaceState, readonly WorkspaceState[]>> = {
  provisioning: ["ready", "recovery_required"],
  ready: ["active", "recovery_required"],
  active: ["active", "paused", "sealing", "recovery_required"],
  paused: ["active", "sealing", "recovery_required"],
  sealing: ["sealed", "recovery_required"],
  sealed: ["integration_pending", "integrated", "recovery_required"],
  integration_pending: ["integrating", "integration_conflict", "recovery_required"],
  integrating: ["integrated", "integration_conflict", "recovery_required"],
  integration_conflict: ["integration_pending", "recovery_required"],
  integrated: ["cleanup_eligible", "recovery_required"],
  cleanup_eligible: ["removing", "recovery_required"],
  removing: ["removed", "cleanup_eligible", "recovery_required"],
  removed: [],
  recovery_required: ["cleanup_eligible", "removed"],
};

function fail(
  code:
    | "workspace_cleanup_blocked"
    | "workspace_dependency_blocked"
    | "workspace_invalid"
    | "workspace_transition_conflict",
  message: string,
): never {
  throw new AgentWorkforceError(code, message);
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validSession(value: WorkspaceWriterSession | null): boolean {
  return (
    value === null ||
    (/^ses_[A-Za-z0-9_-]{8,128}$/u.test(value.sessionId) &&
      validTime(value.startedAt) &&
      (value.lastSeenAt === undefined ||
        (validTime(value.lastSeenAt) &&
          Date.parse(value.lastSeenAt) >= Date.parse(value.startedAt))))
  );
}

function validSeal(value: WorkspaceSealedResult | null): boolean {
  return (
    value !== null &&
    COMMIT.test(value.baseCommit) &&
    COMMIT.test(value.headCommit) &&
    COMMIT.test(value.treeHash) &&
    HASH.test(value.changedPathSetDigest) &&
    Number.isSafeInteger(value.changedPathCount) &&
    value.changedPathCount >= 0 &&
    value.changedPaths.length === value.changedPathCount &&
    value.changedPaths.length <= 10_000 &&
    value.changedPaths.every((path) => SAFE_PATH.test(path)) &&
    new Set(value.changedPaths).size === value.changedPaths.length &&
    value.commitIds.length <= 10_000 &&
    value.commitIds.every((commitId) => COMMIT.test(commitId)) &&
    ARTIFACT_ID.test(value.resultArtifactId) &&
    HASH.test(value.resultArtifactHash) &&
    value.verificationResults.length <= 64 &&
    value.verificationResults.every(
      (result) =>
        /^[a-z][a-z0-9._-]{1,99}$/u.test(result.suiteId) &&
        HASH.test(result.policyHash) &&
        ARTIFACT_ID.test(result.resultArtifactId) &&
        HASH.test(result.resultArtifactHash) &&
        validTime(result.completedAt) &&
        result.passed,
    ) &&
    !value.approvalPending &&
    !value.recoveryPending &&
    (value.sourceWorkstream === null ||
      (/^wks_[a-f0-9]{24}$/u.test(value.sourceWorkstream.workstreamId) &&
        Number.isSafeInteger(value.sourceWorkstream.revision) &&
        value.sourceWorkstream.revision >= 1 &&
        HASH.test(value.sourceWorkstream.snapshotHash))) &&
    validTime(value.sealedAt) &&
    (value.noChange
      ? value.changedPathCount === 0 &&
        value.commitIds.length === 0 &&
        value.headCommit === value.baseCommit
      : value.changedPathCount > 0 && value.commitIds.length > 0)
  );
}

export function isWorkspaceIntegrationQueueEntry(value: WorkspaceIntegrationQueueEntry): boolean {
  return (
    value.schemaVersion === 1 &&
    /^inq_[a-f0-9]{24}$/u.test(value.queueEntryId) &&
    WORKSPACE_ID.test(value.workspaceId) &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1 &&
    /^asn_[a-f0-9]{24}$/u.test(value.assignmentId) &&
    value.dependencyAssignmentIds.length <= 64 &&
    value.dependencyAssignmentIds.every((id) => /^asn_[a-f0-9]{24}$/u.test(id)) &&
    new Set(value.dependencyAssignmentIds).size === value.dependencyAssignmentIds.length &&
    Number.isSafeInteger(value.priority) &&
    value.priority >= 0 &&
    value.priority <= 100 &&
    COMMIT.test(value.headCommit) &&
    COMMIT.test(value.treeHash) &&
    HASH.test(value.changedPathSetDigest) &&
    Number.isSafeInteger(value.changedPathCount) &&
    value.changedPathCount >= 0 &&
    validTime(value.sealedAt) &&
    validTime(value.queuedAt) &&
    Date.parse(value.queuedAt) >= Date.parse(value.sealedAt)
  );
}

export function isAgentWorkspace(value: AgentWorkspace): boolean {
  return (
    value.schemaVersion === 1 &&
    WORKSPACE_ID.test(value.workspaceId) &&
    REPOSITORY_INSTANCE_ID.test(value.repositoryInstanceId) &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1 &&
    Number.isSafeInteger(value.leaseGeneration) &&
    value.leaseGeneration >= 1 &&
    ["worker", "integrator"].includes(value.executionKind) &&
    ["git", "orca"].includes(value.host.kind) &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.host.version) &&
    (value.host.nativeInstanceDigest === null || HASH.test(value.host.nativeInstanceDigest)) &&
    COMMIT.test(value.baseCommit) &&
    HASH.test(value.integrationTargetDigest) &&
    /^wpl_[a-f0-9]{24}$/u.test(value.creationPlanId) &&
    HASH.test(value.markerHash) &&
    HASH.test(value.pathDigest) &&
    (value.ownerWorkspacePath === undefined ||
      (value.ownerWorkspacePath.length <= 4_096 &&
        !value.ownerWorkspacePath.includes("\0") &&
        isAbsolute(value.ownerWorkspacePath))) &&
    validSession(value.writerSession) &&
    Object.hasOwn(transitions, value.state) &&
    (value.sealedResult === null || validSeal(value.sealedResult)) &&
    (value.integrationQueueEntryId === null ||
      /^inq_[a-f0-9]{24}$/u.test(value.integrationQueueEntryId)) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    validTime(value.createdAt) &&
    validTime(value.updatedAt)
  );
}

function requireEvidence(
  evidence: WorkspaceTransitionEvidence,
  fields: (keyof WorkspaceTransitionEvidence)[],
): void {
  const missing = fields.filter((field) => evidence[field] !== true);
  if (missing.length > 0)
    fail("workspace_transition_conflict", `Workspace evidence is missing: ${missing.join(", ")}.`);
}

function validateTransitionEvidence(input: {
  current: AgentWorkspace;
  nextState: WorkspaceState;
  evidence: WorkspaceTransitionEvidence;
  writerSession?: WorkspaceWriterSession | null;
  sealedResult?: WorkspaceSealedResult;
  integrationQueueEntryId?: string;
  integrationEvidenceId?: string;
  cleanupPlanId?: string;
  recoveryReason?: string;
  hostNativeInstanceDigest?: string;
}): void {
  const { nextState, evidence } = input;
  if (nextState === "ready")
    requireEvidence(evidence, ["hostInspected", "markerMatched", "checkoutClean"]);
  if (nextState === "active") {
    if (input.writerSession === undefined || input.writerSession === null)
      fail("workspace_transition_conflict", "Workspace activation requires one writer session.");
  }
  if (nextState === "paused") {
    requireEvidence(evidence, ["writerFrozen"]);
    if (input.writerSession !== null)
      fail("workspace_transition_conflict", "Workspace pause must release its writer session.");
  }
  if (nextState === "sealing") {
    requireEvidence(evidence, ["writerFrozen"]);
    if (input.writerSession !== null)
      fail("workspace_transition_conflict", "Workspace sealing must freeze its writer.");
  }
  if (nextState === "sealed") {
    requireEvidence(evidence, ["checkoutClean"]);
    if (!validSeal(input.sealedResult ?? null))
      fail("workspace_transition_conflict", "Workspace sealing requires an immutable result.");
  }
  if (nextState === "integration_pending") {
    requireEvidence(evidence, ["queueEntryCommitted"]);
    if (!/^inq_[a-f0-9]{24}$/u.test(input.integrationQueueEntryId ?? ""))
      fail("workspace_transition_conflict", "Workspace queue evidence is missing.");
  }
  if (nextState === "integrating") requireEvidence(evidence, ["integrationLeaseHeld"]);
  if (nextState === "integrated") {
    if (input.current.state === "sealed" && input.current.executionKind !== "integrator")
      fail(
        "workspace_transition_conflict",
        "Only an integrator can close its already verified target directly.",
      );
    requireEvidence(evidence, ["integrationVerified"]);
    if (!/^int_[a-f0-9]{24}$/u.test(input.integrationEvidenceId ?? ""))
      fail("workspace_transition_conflict", "Integration evidence is missing.");
  }
  if (nextState === "integration_conflict") requireEvidence(evidence, ["conflictAborted"]);
  if (nextState === "cleanup_eligible") requireEvidence(evidence, ["cleanupEligible"]);
  if (nextState === "removing") {
    requireEvidence(evidence, ["cleanupPlanBound"]);
    if (!/^wcp_[a-f0-9]{24}$/u.test(input.cleanupPlanId ?? ""))
      fail("workspace_transition_conflict", "Cleanup plan evidence is missing.");
  }
  if (nextState === "removed") requireEvidence(evidence, ["hostAbsent", "gitMetadataAbsent"]);
  if (
    nextState === "recovery_required" &&
    !/^[a-z][a-z0-9_]{1,99}$/u.test(input.recoveryReason ?? "")
  )
    fail("workspace_transition_conflict", "Recovery requires one bounded reason code.");
}

export function transitionWorkspace(input: {
  current: AgentWorkspace;
  expectedRevision: number;
  expectedGeneration: number;
  nextState: WorkspaceState;
  occurredAt: string;
  evidence?: WorkspaceTransitionEvidence;
  writerSession?: WorkspaceWriterSession | null;
  sealedResult?: WorkspaceSealedResult;
  integrationQueueEntryId?: string;
  integrationEvidenceId?: string;
  cleanupPlanId?: string;
  recoveryReason?: string;
  hostNativeInstanceDigest?: string;
}): AgentWorkspace {
  if (!isAgentWorkspace(input.current))
    fail("workspace_invalid", "The workspace record is invalid.");
  if (
    input.current.revision !== input.expectedRevision ||
    input.current.generation !== input.expectedGeneration ||
    !validTime(input.occurredAt) ||
    Date.parse(input.occurredAt) < Date.parse(input.current.updatedAt)
  )
    fail("workspace_transition_conflict", "The workspace transition coordinate is stale.");
  if (!transitions[input.current.state].includes(input.nextState))
    fail(
      "workspace_transition_conflict",
      `Workspace state cannot move from ${input.current.state} to ${input.nextState}.`,
    );
  validateTransitionEvidence({ ...input, evidence: input.evidence ?? {} });
  const next: AgentWorkspace = {
    ...input.current,
    state: input.nextState,
    revision: input.current.revision + 1,
    updatedAt: input.occurredAt,
    ...(input.writerSession === undefined ? {} : { writerSession: input.writerSession }),
    ...(input.sealedResult === undefined ? {} : { sealedResult: input.sealedResult }),
    ...(input.integrationQueueEntryId === undefined
      ? {}
      : { integrationQueueEntryId: input.integrationQueueEntryId }),
    ...(input.integrationEvidenceId === undefined
      ? {}
      : { integrationEvidenceId: input.integrationEvidenceId }),
    ...(input.cleanupPlanId === undefined ? {} : { cleanupPlanId: input.cleanupPlanId }),
    ...(input.recoveryReason === undefined ? {} : { recoveryReason: input.recoveryReason }),
    ...(input.hostNativeInstanceDigest === undefined
      ? {}
      : { host: { ...input.current.host, nativeInstanceDigest: input.hostNativeInstanceDigest } }),
  };
  if (!isAgentWorkspace(next))
    fail("workspace_invalid", "The resulting workspace record is invalid.");
  return next;
}

const cleanupReasons: ReadonlyArray<readonly [keyof WorkspaceCleanupObservation, string]> = [
  ["owned", "workspace_not_owned"],
  ["stateIntegrated", "workspace_not_integrated"],
  ["sealedBytesMatch", "sealed_bytes_changed"],
  ["checkoutClean", "checkout_dirty"],
  ["headReachable", "head_unreachable"],
  ["leaseAbsent", "assignment_lease_live"],
  ["writerAbsent", "writer_live"],
  ["terminalAbsent", "terminal_live_or_uncertain"],
  ["childWorkspaceAbsent", "child_workspace_present"],
  ["gitOperationAbsent", "git_operation_in_progress"],
  ["reviewLinkAbsent", "review_link_present"],
  ["transactionAbsent", "transaction_in_progress"],
  ["approvalAbsent", "approval_pending"],
  ["recoveryMarkerAbsent", "recovery_required"],
  ["markerMatched", "marker_mismatch"],
  ["repositoryMatched", "repository_mismatch"],
  ["adapterMatched", "adapter_mismatch"],
  ["pathMatched", "path_mismatch"],
  ["quiescenceProven", "quiescence_unproven"],
  ["nonForceRemovalSupported", "non_force_removal_unsupported"],
];

export function evaluateWorkspaceCleanup(input: WorkspaceCleanupObservation): {
  eligible: boolean;
  reasons: string[];
} {
  const reasons = cleanupReasons.filter(([field]) => !input[field]).map(([, reason]) => reason);
  return { eligible: reasons.length === 0, reasons };
}

function pathContains(scope: string, path: string): boolean {
  return repositoryPathWithinScope(path, scope);
}

export function partitionWorkspaceChanges(input: {
  expectedPaths: string[];
  changedPaths: string[];
  runtimeExcludedPaths?: string[];
}): { expected: string[]; outsideScope: string[]; runtimeExcluded: string[] } {
  const expected: string[] = [];
  const outsideScope: string[] = [];
  const runtimeExcluded: string[] = [];
  for (const path of [...new Set(input.changedPaths)].sort()) {
    if ((input.runtimeExcludedPaths ?? []).some((scope) => pathContains(scope, path)))
      runtimeExcluded.push(path);
    else if (input.expectedPaths.some((scope) => pathContains(scope, path))) expected.push(path);
    else outsideScope.push(path);
  }
  return { expected, outsideScope, runtimeExcluded };
}

export function orderWorkspaceIntegrations(
  candidates: WorkspaceIntegrationCandidate[],
  completedAssignmentIds: string[] = [],
): WorkspaceIntegrationCandidate[] {
  const pending = new Map(candidates.map((candidate) => [candidate.assignmentId, candidate]));
  if (pending.size !== candidates.length)
    fail("workspace_dependency_blocked", "Integration candidates contain duplicate assignments.");
  const completed = new Set(completedAssignmentIds);
  const ordered: WorkspaceIntegrationCandidate[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()]
      .filter((candidate) => candidate.dependencyAssignmentIds.every((id) => completed.has(id)))
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          Date.parse(left.sealedAt) - Date.parse(right.sealedAt) ||
          left.workspaceId.localeCompare(right.workspaceId),
      );
    if (ready.length === 0)
      fail("workspace_dependency_blocked", "Integration dependencies are missing or cyclic.");
    for (const candidate of ready) {
      ordered.push(candidate);
      pending.delete(candidate.assignmentId);
      completed.add(candidate.assignmentId);
    }
  }
  return ordered;
}
