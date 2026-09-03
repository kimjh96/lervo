import type {
  ApplicationAssignmentStatus,
  ApplicationLeaseState,
  ApprovalObservationV1,
  AssignmentCommunicationReportV1,
  AssignmentInboxRouteV1,
  AssignmentInteractionRouteV1,
  AssignmentCompletionEvidenceV1,
  GovernedLoopActionV1,
  GovernedLoopDecisionV1,
  ManagedAttemptObservationV1,
  OperatingObjectiveReportV1,
  ResourceGroupObservationV1,
} from "@lervo/application-contract";

export interface OperatingBoardSummaryV1 {
  assignmentCount: number;
  assignmentStatusCounts: Record<ApplicationAssignmentStatus, number>;
  attemptCount: number;
  preparedCompletionCount: number;
  verifiedApprovalCount: number;
  attentionApprovalCount: number;
  resourceGroupCount: number;
  interactionRouteCount: number;
  inboxRouteCount: number;
}

export interface OperatingBoardNodeV1 {
  assignmentId: string;
  assignmentRevision: number;
  taskType: string;
  roleId: string;
  status: ApplicationAssignmentStatus;
  priority: number;
  dependencyIds: string[];
  isRoot: boolean;
  isJoin: boolean;
  approvalRequirementDigests: string[];
  leaseState: ApplicationLeaseState;
  assigneeAgentId: string | null;
  leaseId: string | null;
  declaredAttemptCount: number;
  attempts: ManagedAttemptObservationV1[];
  approvals: ApprovalObservationV1[];
  completionEvidence: AssignmentCompletionEvidenceV1[];
  actions: GovernedLoopActionV1[];
  interactionRoutes: AssignmentInteractionRouteV1[];
}

export interface OperatingBoardViewV1 {
  schemaVersion: 1;
  source: {
    projectId: string;
    workstreamId: string;
    graphId: string;
    graphHash: string;
    observedAt: string;
    decisionId: string;
  };
  state: {
    decisionStatus: GovernedLoopDecisionV1["status"];
    graphValidity: "valid" | "invalid";
    graphReasonCodes: string[];
  };
  summary: OperatingBoardSummaryV1;
  objective: OperatingObjectiveReportV1 | null;
  nodes: OperatingBoardNodeV1[];
  actions: GovernedLoopActionV1[];
  resources: ResourceGroupObservationV1[];
  budgets: OperatingBudgetGroupV1[];
  inbox: AssignmentInboxRouteV1[];
  communicationValidity: AssignmentCommunicationReportV1["validity"] | null;
  limitations: string[];
}

export interface OperatingBudgetGroupV1 {
  provider: "codex" | "claude" | "lervo";
  scope: ResourceGroupObservationV1["scope"] | null;
  accountingDescriptorHash: string;
  limitTokens: number;
  observedTokens: number | null;
  remainingObservedTokens: number | null;
  completeness: "complete" | "partial" | "unavailable" | "invalid" | "unobserved";
  thresholdState: "below" | "reached" | "unknown";
}
