export interface WorkResponsibilityV1 {
  schemaVersion: 1;
  assignmentId: string;
  assignmentRevision: number;
  executorAgentId: string;
  reviewerAgentId: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  taskPurpose: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  decisionLatitude: string[];
  expectedPaths: string[];
  requiredCapabilities: string[];
  verificationSuiteIds: string[];
  handoffRecipientIds: string[];
  startDeadline: string;
  progressDeadline: string;
  completionDeadline: string;
  predecessorBindingHash: string | null;
}

export interface WorkerReadinessObservationV1 {
  schemaVersion: 1;
  sourceRevisionDigest: string;
  responsibilityArtifactHash: string;
  agentId: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  observedAt: string;
  validUntil: string;
  checks: {
    kind:
      | "provider"
      | "tools"
      | "cli"
      | "read_scope"
      | "write_scope"
      | "knowledge"
      | "source_policy"
      | "verification"
      | "budget"
      | "workspace"
      | "ancestry"
      | "lease";
    status: "passed" | "failed" | "unobserved" | "not_required";
    evidenceHash: string | null;
  }[];
}
