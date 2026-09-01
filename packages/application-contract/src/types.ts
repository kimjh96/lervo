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

export interface ResourceGroupObservationV1 {
  schemaVersion: 1;
  provider: "codex" | "claude" | "lervo";
  source: "provider_reported" | "lervo_measured";
  accountingMode: "turn_cumulative" | "session_cumulative" | "operation_delta";
  accountingDescriptorHash: string;
  completeness: "complete" | "partial" | "unavailable" | "invalid";
  totalTokens: number | null;
  runCount: number;
  reasonCodes: string[];
}

interface ApprovalObservationBaseV1 {
  schemaVersion: 1;
  assignmentId: string;
  assignmentRevision: number;
  requirementDigest: string;
}

export type ApprovalObservationV1 =
  | (ApprovalObservationBaseV1 & {
      status: "verified";
      approvalId: string;
      authorityId: string;
      authorityEvidenceHash: string;
      grantedAt: string;
      expiresAt: string;
    })
  | (ApprovalObservationBaseV1 & {
      status: "missing" | "invalid";
      reasonCode: string;
    });

export interface ApprovalAuthorityRequirementV1 {
  assignmentId: string;
  assignmentRevision: number;
  requirementDigest: string;
}

export interface ApprovalAuthorityQueryV1 {
  schemaVersion: 1;
  projectId: string;
  workstreamId: string;
  observedAt: string;
  requirements: ApprovalAuthorityRequirementV1[];
}

export interface ApprovalAuthorityPort {
  observe(query: ApprovalAuthorityQueryV1): Promise<ApprovalObservationV1[]>;
}

export interface GovernedTokenLimitV1 {
  provider: "codex" | "claude" | "lervo";
  accountingDescriptorHash: string;
  stopAfterObservedTotalTokens: number;
}

export interface GovernedLoopPolicyV1 {
  schemaVersion: 1;
  maxAttemptsPerAssignment: number;
  maxParallelAssignments: number;
  tokenLimits: GovernedTokenLimitV1[];
  unobservedResourceAction: "block" | "escalate";
  exhaustedResourceAction: "block" | "escalate";
  terminalFailureAction: "block" | "escalate";
}

export type ManagedAttemptCausalityV1 =
  | {
      relationship: "root";
      workstreamId: string;
      assignmentId: string;
      agentId: string;
    }
  | {
      relationship: "retry";
      workId: string;
      parentRunId: string;
      retryOfRunId: string;
      attemptOrdinal: number;
      workstreamId: string;
      assignmentId: string;
      agentId: string;
    };

export type GovernedLoopActionV1 =
  | {
      kind: "claim_assignment";
      assignmentId: string;
      reasonCode: "ready" | "lease_expired";
    }
  | {
      kind: "start_attempt" | "retry_attempt";
      assignmentId: string;
      reasonCode: "ready" | "attempt_failed";
      causality: ManagedAttemptCausalityV1;
    }
  | {
      kind: "await_approval";
      assignmentId: string;
      reasonCode: "approval_missing" | "approval_invalid";
      requirementDigests: string[];
    }
  | {
      kind: "cancel_assignment";
      assignmentId: string;
      reasonCode: "dependency_cancelled";
    }
  | {
      kind: "wait";
      assignmentId: string | null;
      reasonCode: "active_attempt" | "dependencies_incomplete" | "no_assignments";
    }
  | {
      kind: "block" | "escalate";
      assignmentId: string | null;
      reasonCode:
        | "graph_invalid"
        | "assignment_blocked"
        | "assignment_failed"
        | "attempts_exhausted"
        | "resource_exhausted"
        | "resource_unobservable"
        | "work_cancelled"
        | "approval_observation_invalid"
        | "completion_reconciliation_required";
    }
  | {
      kind: "complete_work";
      assignmentId: null;
      reasonCode: "all_assignments_completed";
    };

export interface GovernedLoopDecisionV1 {
  schemaVersion: 1;
  decisionId: string;
  graphHash: string;
  status: "ready" | "waiting" | "blocked" | "escalation_required" | "complete" | "invalid";
  actions: GovernedLoopActionV1[];
}

export interface GovernedWorkReportV1 {
  schemaVersion: 1;
  projectId: string;
  workstreamId: string;
  graph: WorkGraphV1;
  attempts: ManagedAttemptObservationV1[];
  resources: ResourceGroupObservationV1[];
  approvals: ApprovalObservationV1[];
  policy: GovernedLoopPolicyV1;
  decision: GovernedLoopDecisionV1;
}

export interface GovernedWorkQueryV1 {
  schemaVersion: 1;
  kind: "governed_work.inspect";
  projectId: string;
  workstreamId: string;
  observedAt: string;
  policy: GovernedLoopPolicyV1;
}

export interface GovernedAttemptCommandV1 {
  schemaVersion: 1;
  kind: "governed_attempt.execute";
  commandId: string;
  projectId: string;
  workstreamId: string;
  expectedGraphHash: string;
  assignmentId: string;
  causality: ManagedAttemptCausalityV1;
}
