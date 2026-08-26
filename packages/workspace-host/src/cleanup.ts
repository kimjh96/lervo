import type {
  WorkspaceHostInspection,
  WorkspaceOwnershipMarker,
  WorkspaceRemovalRequest,
} from "./index.js";

export interface WorkspaceCleanupInspectionRequest {
  repositoryRoot: string;
  workspacePath: string;
  baseCommit: string;
  marker: WorkspaceOwnershipMarker;
  integrationTargetRef: string;
  integratedHeadCommit: string;
}

export interface WorkspaceCleanupHostInspection extends WorkspaceHostInspection {
  integrationTargetCommit: string | null;
  headReachableFromTarget: boolean | null;
  gitMetadataHash: string | null;
  dependentReferenceCount: number | null;
  childWorkspaceCount: number | null;
  reviewLinkCount: number | null;
}

export interface WorkspaceCleanupHostAdapter {
  readonly kind: "git" | "orca";
  readonly version: string;
  readonly capabilities: {
    cleanupInspection: boolean;
    nonForceRemoval: boolean;
    processObservation: boolean;
  };
  inspectCleanup(
    request: WorkspaceCleanupInspectionRequest,
  ): Promise<WorkspaceCleanupHostInspection>;
  remove(request: WorkspaceRemovalRequest): Promise<WorkspaceHostInspection>;
}
