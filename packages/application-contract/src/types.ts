export type ApplicationAssignmentStatus =
  "queued" | "leased" | "blocked" | "completed" | "failed" | "cancelled";

export type ApplicationLeaseState = "none" | "active" | "expired";

export interface WorkGraphNodeV1 {
  assignmentId: string;
  assignmentRevision: number;
  taskType: string;
  roleId: string;
  status: ApplicationAssignmentStatus;
  priority: number;
  dependencyIds: string[];
  approvalRequirementDigests: string[];
  leaseState: ApplicationLeaseState;
  assigneeAgentId: string | null;
  leaseId: string | null;
  attemptCount: number;
}

export interface WorkGraphV1 {
  schemaVersion: 1;
  graphId: string;
  graphHash: string;
  projectId: string;
  workstreamId: string;
  observedAt: string;
  validity: {
    status: "valid" | "invalid";
    reasonCodes: string[];
  };
  nodes: WorkGraphNodeV1[];
  rootAssignmentIds: string[];
  joinAssignmentIds: string[];
}

export interface ManagedAttemptObservationV1 {
  schemaVersion: 1;
  assignmentId: string;
  workId: string;
  runId: string;
  relationship: "root" | "retry";
  attemptOrdinal: number;
  terminalStatus: "in_progress" | "completed" | "failed";
  verificationStatus: "passed" | "failed" | "not_run" | "unavailable";
}

export interface AssignmentCompletionEvidenceV1 {
  schemaVersion: 1;
  completionEvidenceId: string;
  workstreamId: string;
  assignmentId: string;
  assignmentRevision: number;
  agentId: string;
  leaseId: string;
  runId: string;
  sessionId: string;
  resultArtifactId: string;
  resultContentHash: string;
  preparedAt: string;
}
