/** `released` is terminal: the attempt's effect never reached its target (ADR-0222). */
export type WorkspaceIntegrationAttemptState =
  "leased" | "candidate" | "advancing" | "integrated" | "conflict" | "released";

export interface WorkspaceIntegrationVerificationCoordinate {
  suiteId: string;
  suiteHash: string;
  verificationId: string;
  resultArtifactId: string;
  resultContentHash: string;
}

export interface WorkspaceIntegrationAttemptSource {
  workspaceId: string;
  generation: number;
  headCommit: string;
  treeHash: string;
  strategy: "fast_forward" | "cherry_pick" | "merge";
}

export interface WorkspaceIntegrationAttempt {
  schemaVersion: 1;
  attemptId: string;
  targetLeaseId: string;
  planContentHash: string;
  repositoryInstanceId: string;
  targetDigest: string;
  targetGeneration: number;
  targetBeforeCommit: string;
  integrationAssignmentId: string;
  integratorAgentId: string;
  integratorWorkspaceId: string;
  integratorWorkspaceGeneration: number;
  sources: WorkspaceIntegrationAttemptSource[];
  state: WorkspaceIntegrationAttemptState;
  candidateCommit: string | null;
  candidateTreeHash: string | null;
  verificationReceiptHash: string | null;
  verificationResults: WorkspaceIntegrationVerificationCoordinate[];
  targetAfterCommit: string | null;
  conflictWorkspaceId: string | null;
  conflictReason: "git_conflict" | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceIntegrationAttemptEvent {
  schemaVersion: 1;
  type: "assignment.integration.state.changed";
  eventId: string;
  occurredAt: string;
  attemptId: string;
  targetLeaseId: string;
  repositoryInstanceId: string;
  targetDigest: string;
  targetGeneration: number;
  targetBeforeCommit: string;
  integrationAssignmentId: string;
  integratorAgentId: string;
  integratorWorkspaceId: string;
  sources: Array<{ workspaceId: string; generation: number; headCommit: string }>;
  previousState: WorkspaceIntegrationAttemptState | "absent";
  state: WorkspaceIntegrationAttemptState;
  candidateCommit: string | null;
  candidateTreeHash: string | null;
  verificationReceiptHash: string | null;
  targetAfterCommit: string | null;
  conflictWorkspaceId: string | null;
  conflictReason: "git_conflict" | null;
  revision: number;
}

export interface WorkspaceIntegrationRecordedEvent {
  schemaVersion: 1;
  type: "assignment.integration.recorded";
  eventId: string;
  occurredAt: string;
  attemptId: string;
  targetLeaseId: string;
  repositoryInstanceId: string;
  targetDigest: string;
  targetGeneration: number;
  integrationAssignmentId: string;
  integratorAgentId: string;
  integratorWorkspaceId: string;
  sources: Array<{
    workspaceId: string;
    generation: number;
    headCommit: string;
    strategy: "fast_forward" | "cherry_pick" | "merge";
  }>;
  targetBeforeCommit: string;
  targetAfterCommit: string;
  verificationReceiptHash: string;
  verificationResults: WorkspaceIntegrationVerificationCoordinate[];
  revision: number;
}
