export type WorkspaceHostKind = "git" | "orca";

export interface WorkspaceOwnershipMarker {
  schemaVersion: 1;
  workspaceId: string;
  generation: number;
  repositoryInstanceId: string;
  adapterKind: WorkspaceHostKind;
  adapterVersion: string;
  creationPlanId: string;
  pathDigest: string;
}

export interface WorkspaceHostInspection {
  status: "present" | "absent" | "recovery_required";
  headCommit: string | null;
  treeHash: string | null;
  clean: boolean | null;
  gitOperationInProgress: boolean | null;
  changedPaths: string[] | null;
  markerMatched: boolean;
  processObservation: "quiescent" | "live" | "unavailable";
  nativeInstanceDigest: string | null;
}

export interface WorkspaceResultInspection extends WorkspaceHostInspection {
  baseCommitReachable: boolean | null;
  commitIds: string[] | null;
}

export interface WorkspaceProvisionRequest {
  repositoryRoot: string;
  workspacePath: string;
  baseCommit: string;
  marker: WorkspaceOwnershipMarker;
  idempotencyKey: string;
}

export interface WorkspaceInspectionRequest {
  repositoryRoot: string;
  workspacePath: string;
  baseCommit: string;
  marker: WorkspaceOwnershipMarker;
}

export type WorkspaceResultInspectionRequest = WorkspaceInspectionRequest;

export interface WorkspaceRemovalRequest {
  repositoryRoot: string;
  workspacePath: string;
  baseCommit: string;
  marker: WorkspaceOwnershipMarker;
  idempotencyKey: string;
}

export interface WorkspaceHostAdapter {
  readonly kind: WorkspaceHostKind;
  readonly version: string;
  readonly capabilities: {
    provision: boolean;
    inspect: boolean;
    nonForceRemoval: boolean;
    processObservation: boolean;
  };
  provision(request: WorkspaceProvisionRequest): Promise<WorkspaceHostInspection>;
  inspect(request: WorkspaceInspectionRequest): Promise<WorkspaceHostInspection>;
  inspectResult(request: WorkspaceResultInspectionRequest): Promise<WorkspaceResultInspection>;
  remove(request: WorkspaceRemovalRequest): Promise<WorkspaceHostInspection>;
}

export type WorkspaceHostErrorCode =
  | "host_coordinate_invalid"
  | "host_effect_uncertain"
  | "host_git_failed"
  | "host_marker_mismatch"
  | "host_not_clean"
  | "host_operation_in_progress";

export class WorkspaceHostError extends Error {
  constructor(
    readonly code: WorkspaceHostErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceHostError";
  }
}

export * from "./integration.js";
