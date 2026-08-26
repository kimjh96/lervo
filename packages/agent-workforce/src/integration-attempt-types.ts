export type WorkspaceIntegrationAttemptState = "leased" | "candidate" | "conflict";

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
  conflictWorkspaceId: string | null;
  conflictReason: "git_conflict" | null;
  revision: number;
}
