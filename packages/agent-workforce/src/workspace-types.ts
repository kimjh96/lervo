export type WorkspaceExecutionKind = "worker" | "integrator" | "unmanaged";

export type WorkspaceState =
  | "provisioning"
  | "ready"
  | "active"
  | "paused"
  | "sealing"
  | "sealed"
  | "integration_pending"
  | "integrating"
  | "integrated"
  | "integration_conflict"
  | "cleanup_eligible"
  | "removing"
  | "removed"
  | "recovery_required";

export interface WorkspaceWriterSession {
  sessionId: string;
  startedAt: string;
  lastSeenAt?: string;
}

export interface WorkspaceVerificationResult {
  suiteId: string;
  policyHash: string;
  resultArtifactId: string;
  resultArtifactHash: string;
  completedAt: string;
  passed: boolean;
}

export interface WorkspaceWorkstreamBinding {
  workstreamId: string;
  revision: number;
  snapshotHash: string;
}

export interface WorkspaceSealedResult {
  baseCommit: string;
  headCommit: string;
  treeHash: string;
  changedPathSetDigest: string;
  changedPathCount: number;
  changedPaths: string[];
  commitIds: string[];
  resultArtifactId: string;
  resultArtifactHash: string;
  verificationResults: WorkspaceVerificationResult[];
  approvalPending: boolean;
  recoveryPending: boolean;
  sourceWorkstream: WorkspaceWorkstreamBinding | null;
  noChange: boolean;
  sealedAt: string;
}

export interface AgentWorkspace {
  schemaVersion: 1;
  workspaceId: string;
  generation: number;
  repositoryInstanceId: string;
  projectId: string;
  assignmentId: string;
  agentId: string;
  leaseGeneration: number;
  executionKind: Exclude<WorkspaceExecutionKind, "unmanaged">;
  host: {
    kind: "git" | "orca";
    version: string;
    nativeInstanceDigest: string | null;
  };
  baseCommit: string;
  integrationTargetDigest: string;
  creationPlanId: string;
  markerHash: string;
  pathDigest: string;
  ownerWorkspacePath?: string;
  state: WorkspaceState;
  writerSession: WorkspaceWriterSession | null;
  sealedResult: WorkspaceSealedResult | null;
  integrationQueueEntryId: string | null;
  integrationEvidenceId: string | null;
  cleanupPlanId: string | null;
  recoveryReason: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTransitionEvidence {
  hostInspected?: boolean;
  markerMatched?: boolean;
  checkoutClean?: boolean;
  writerFrozen?: boolean;
  queueEntryCommitted?: boolean;
  integrationLeaseHeld?: boolean;
  integrationVerified?: boolean;
  conflictAborted?: boolean;
  cleanupEligible?: boolean;
  cleanupPlanBound?: boolean;
  hostAbsent?: boolean;
  gitMetadataAbsent?: boolean;
}

export interface WorkspaceCleanupObservation {
  owned: boolean;
  stateIntegrated: boolean;
  sealedBytesMatch: boolean;
  checkoutClean: boolean;
  headReachable: boolean;
  leaseAbsent: boolean;
  writerAbsent: boolean;
  terminalAbsent: boolean;
  childWorkspaceAbsent: boolean;
  gitOperationAbsent: boolean;
  reviewLinkAbsent: boolean;
  transactionAbsent: boolean;
  approvalAbsent: boolean;
  recoveryMarkerAbsent: boolean;
  markerMatched: boolean;
  repositoryMatched: boolean;
  adapterMatched: boolean;
  pathMatched: boolean;
  quiescenceProven: boolean;
  nonForceRemovalSupported: boolean;
}

export interface WorkspaceIntegrationCandidate {
  workspaceId: string;
  generation: number;
  assignmentId: string;
  dependencyAssignmentIds: string[];
  priority: number;
  sealedAt: string;
}

export interface WorkspaceIntegrationQueueEntry {
  schemaVersion: 1;
  queueEntryId: string;
  workspaceId: string;
  generation: number;
  assignmentId: string;
  dependencyAssignmentIds: string[];
  priority: number;
  headCommit: string;
  treeHash: string;
  changedPathSetDigest: string;
  changedPathCount: number;
  sealedAt: string;
  queuedAt: string;
}

export interface WorkspaceCheckpoint {
  schemaVersion: 1;
  type: "agent.workspace.checkpointed";
  eventId: string;
  workspaceId: string;
  generation: number;
  workspaceRevision: number;
  assignmentId: string;
  assignmentRevision: number;
  leaseGeneration: number;
  writerSessionId: string;
  headCommit: string;
  treeHash: string;
  changedPathSetDigest: string;
  changedPathCount: number;
  checkoutClean: boolean;
  occurredAt: string;
}
