export type WorkspaceCleanupJournalPhase = "prepared" | "removal_observed";

export interface WorkspaceCleanupOwnershipMarker {
  schemaVersion: 1;
  workspaceId: string;
  generation: number;
  repositoryInstanceId: string;
  adapterKind: "git" | "orca";
  adapterVersion: string;
  creationPlanId: string;
  pathDigest: string;
}

export interface WorkspaceCleanupJournal {
  schemaVersion: 1;
  journalId: string;
  planId: string;
  planContentHash: string;
  workspaceId: string;
  generation: number;
  repositoryInstanceId: string;
  repositoryRoot: string;
  workspacePath: string;
  baseCommit: string;
  integratedHeadCommit: string;
  marker: WorkspaceCleanupOwnershipMarker;
  idempotencyKey: string;
  phase: WorkspaceCleanupJournalPhase;
  removalObservedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
