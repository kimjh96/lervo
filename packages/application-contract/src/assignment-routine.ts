export type AssignmentRoutineConcurrencyModeV1 =
  "skip_if_active" | "coalesce_if_active" | "enqueue_bounded";

export interface AssignmentRoutineTemplateNodeV1 {
  nodeKey: string;
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  priority: number;
  dependencyNodeKeys: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements: string[];
  expectedPaths: string[];
}

export interface AssignmentRoutineTemplateV1 {
  schemaVersion: 1;
  routineId: string;
  templateVersion: string;
  concurrency: {
    mode: AssignmentRoutineConcurrencyModeV1;
    maximumActiveInstances: number;
  };
  nodes: AssignmentRoutineTemplateNodeV1[];
}

export interface AssignmentRoutineManualTriggerV1 {
  schemaVersion: 1;
  kind: "manual";
  requestDigest: string;
  idempotencyKey: string;
  observedAt: string;
}

export interface AssignmentRoutineAuthenticatedLiveTriggerV1 {
  schemaVersion: 1;
  kind: "authenticated_live";
  requestDigest: string;
  idempotencyKey: string;
  observedAt: string;
  adapterId: string;
  adapterVersion: string;
  descriptorHash: string;
  sourceId: string;
  authorizationHash: string;
  authenticationReceiptHash: string;
}

export type AssignmentRoutineTriggerV1 =
  AssignmentRoutineManualTriggerV1 | AssignmentRoutineAuthenticatedLiveTriggerV1;

export interface AssignmentRoutineRequestV1 {
  schemaVersion: 1;
  workstreamId: string;
  template: AssignmentRoutineTemplateV1;
  trigger: AssignmentRoutineTriggerV1;
}

export interface AssignmentRoutineRoleContractV1 {
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
}

export interface AssignmentRoutineAssignmentObservationV1 {
  assignmentId: string;
  revision: number;
  status: "queued" | "leased" | "blocked" | "completed" | "failed" | "cancelled";
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  priority: number;
  dependencyIds: string[];
  acceptanceDigest: string;
  verificationDigest: string;
  approvalDigest: string;
  expectedPathDigest: string;
  routine: AssignmentRoutineProvenanceV1 | null;
}

export interface AssignmentRoutineProvenanceV1 {
  routineId: string;
  templateVersion: string;
  templateHash: string;
  invocationId: string;
  triggerKind: AssignmentRoutineTriggerV1["kind"];
  triggerDigest: string;
  nodeKey: string;
}

export type AssignmentRoutineBlockedReasonV1 =
  | "assignment_capacity"
  | "concurrency_state_invalid"
  | "existing_assignment_mismatch"
  | "routine_concurrency_limit"
  | "role_contract_missing"
  | "role_contract_stale"
  | "workstream_mismatch";

export interface AssignmentRoutinePlanStepV1 {
  nodeKey: string;
  assignmentId: string;
  dependencyIds: string[];
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  materializationDigest: string;
}

export interface AssignmentRoutinePlanV1 {
  schemaVersion: 1;
  planId: string;
  status: "ready" | "current" | "blocked";
  disposition:
    "materialize" | "resume" | "already_materialized" | "skipped" | "coalesced" | "blocked";
  projectId: string;
  workstreamId: string;
  routineId: string;
  templateVersion: string;
  templateHash: string;
  invocationId: string;
  triggerDigest: string;
  assignmentSnapshotHash: string;
  activeInvocationIds: string[];
  relatedInvocationId: string | null;
  steps: AssignmentRoutinePlanStepV1[];
  blockedReasons: AssignmentRoutineBlockedReasonV1[];
}

export interface AssignmentRoutineApplyReceiptV1 {
  schemaVersion: 1;
  planId: string;
  invocationId: string;
  status: "completed";
  createdAssignmentIds: string[];
  existingAssignmentIds: string[];
}
