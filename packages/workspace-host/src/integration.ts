import type { WorkspaceHostInspection, WorkspaceOwnershipMarker } from "./index.js";

export type WorkspaceIntegrationStrategy = "fast_forward" | "cherry_pick" | "merge";

export interface WorkspaceIntegrationSource {
  workspaceId: string;
  generation: number;
  headCommit: string;
  commitIds: string[];
  strategy: WorkspaceIntegrationStrategy;
}

export interface WorkspaceIntegrationTargetRequest {
  repositoryRoot: string;
  integrationWorkspacePath: string;
  integrationBaseCommit: string;
  integrationMarker: WorkspaceOwnershipMarker;
  targetRef: string;
  targetBeforeCommit: string;
}

export interface WorkspaceIntegrationTargetInspection {
  workspace: WorkspaceHostInspection;
  targetCommit: string | null;
}

export interface WorkspaceIntegrationApplyRequest extends WorkspaceIntegrationTargetRequest {
  attemptId: string;
  idempotencyKey: string;
  sources: WorkspaceIntegrationSource[];
  commitTime: string;
}

export interface WorkspaceIntegrationApplyResult {
  status: "candidate" | "conflict";
  targetBeforeCommit: string;
  candidateCommit: string | null;
  candidateTreeHash: string | null;
  conflictWorkspaceId: string | null;
  conflictReason: "git_conflict" | null;
  operationAborted: boolean;
  targetUnchanged: boolean;
}

export interface WorkspaceIntegrationResetRequest extends WorkspaceIntegrationTargetRequest {
  candidateCommit: string;
  idempotencyKey: string;
}

export interface WorkspaceIntegrationAdvanceRequest extends WorkspaceIntegrationTargetRequest {
  candidateCommit: string;
  candidateTreeHash: string;
  idempotencyKey: string;
}

export interface WorkspaceIntegrationAdvanceResult {
  status: "advanced" | "already_advanced";
  targetBeforeCommit: string;
  targetAfterCommit: string;
  candidateCommit: string;
}

export type WorkspaceIntegrationRollbackRequest = WorkspaceIntegrationAdvanceRequest;

export interface WorkspaceIntegrationHostAdapter {
  readonly kind: "git" | "orca";
  readonly version: string;
  readonly capabilities: {
    exactIntegration: boolean;
    conflictAbort: boolean;
    targetAdvance: boolean;
  };
  inspectTarget(
    request: WorkspaceIntegrationTargetRequest,
  ): Promise<WorkspaceIntegrationTargetInspection>;
  applyIntegration(
    request: WorkspaceIntegrationApplyRequest,
  ): Promise<WorkspaceIntegrationApplyResult>;
  advanceTarget(
    request: WorkspaceIntegrationAdvanceRequest,
  ): Promise<WorkspaceIntegrationAdvanceResult>;
  rollbackTarget(request: WorkspaceIntegrationRollbackRequest): Promise<boolean>;
  resetCandidate(request: WorkspaceIntegrationResetRequest): Promise<boolean>;
}
