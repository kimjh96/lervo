import type { WorkGraphNodeV1, WorkGraphV1 } from "./types.js";

export interface AssignmentTopologyNodeV2 {
  nodeKey: string;
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  priority: number;
  dependencyAssignmentIds: string[];
  dependencyNodeKeys: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements: string[];
  expectedPaths: string[];
}

export interface AssignmentTopologyChangeRequestV2 {
  schemaVersion: 2;
  kind: "assignment_topology.change";
  workstreamId: string;
  expectedGraphHash: string;
  changeKey: string;
  nodes: AssignmentTopologyNodeV2[];
}

export interface AssignmentTopologyRoleContractV2 {
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
}

export interface AssignmentTopologyProvenanceV2 {
  contractVersion: 2;
  changeId: string;
  changeKey: string;
  requestHash: string;
  planId: string;
  approvalHash: string;
  reviewerIdDigest: string;
  expectedNodeCount: number;
  nodeSetHash: string;
  nodeKey: string;
  policyReview?: AssignmentTopologyPolicyReviewBindingV1;
}

export interface AssignmentTopologyPolicyReviewBindingV1 {
  schemaVersion: 1;
  decisionId: string;
  reviewHash: string;
}

export interface AssignmentTopologyAssignmentObservationV2 {
  assignmentId: string;
  revision: number;
  status: "queued" | "leased" | "blocked" | "completed" | "failed" | "cancelled";
  workstreamId: string | null;
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
  topology: AssignmentTopologyProvenanceV2 | null;
}

export type AssignmentTopologyBlockedReasonV2 =
  | "assignment_capacity"
  | "dependency_cycle"
  | "dependency_duplicate"
  | "dependency_escape"
  | "existing_assignment_mismatch"
  | "graph_changed"
  | "graph_invalid"
  | "role_contract_missing"
  | "role_contract_stale"
  | "topology_bounds_exceeded"
  | "workstream_mismatch";

export interface AssignmentTopologyPlanStepV2 {
  nodeKey: string;
  assignmentId: string;
  dependencyIds: string[];
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  materializationDigest: string;
}

export interface AssignmentTopologyPlanV2 {
  schemaVersion: 2;
  kind: "assignment_topology.plan";
  planId: string;
  approvalHash: string;
  status: "ready" | "current" | "blocked";
  disposition: "materialize" | "resume" | "already_applied" | "blocked";
  projectId: string;
  workstreamId: string;
  expectedGraphHash: string;
  currentGraphHash: string;
  requestHash: string;
  assignmentSnapshotHash: string;
  changeId: string;
  changeKey: string;
  branchAssignmentIds: string[];
  joinAssignmentIds: string[];
  steps: AssignmentTopologyPlanStepV2[];
  blockedReasons: AssignmentTopologyBlockedReasonV2[];
}

export interface AssignmentTopologyApplyReceiptV2 {
  schemaVersion: 2;
  kind: "assignment_topology.applied";
  planId: string;
  approvalHash: string;
  changeId: string;
  reviewerIdDigest: string;
  status: "completed";
  createdAssignmentIds: string[];
  existingAssignmentIds: string[];
}

export interface AssignmentTopologyHistoryChangeV2 {
  changeId: string;
  planIds: string[];
  approvalHash: string;
  reviewerIdDigest: string;
  assignmentIds: string[];
  occurredAt: string;
  policyReview?: AssignmentTopologyPolicyReviewBindingV1;
}

export interface AssignmentTopologyHistoryV2 {
  schemaVersion: 2;
  status: "valid" | "recovery_required" | "invalid";
  reasonCodes: string[];
  changes: AssignmentTopologyHistoryChangeV2[];
}

export interface WorkGraphNodeV2 extends WorkGraphNodeV1 {
  topology: AssignmentTopologyProvenanceV2 | null;
}

export interface WorkGraphV2 extends Omit<WorkGraphV1, "schemaVersion" | "nodes"> {
  schemaVersion: 2;
  contractVersion: 2;
  nodes: WorkGraphNodeV2[];
  branchAssignmentIds: string[];
  topologyHistory: AssignmentTopologyHistoryV2;
}
