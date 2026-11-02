import type { OperatingActionKind } from "./operating-mandate.js";

export interface SupervisedAssignmentObservationV1 {
  assignmentId: string;
  revision: number;
  executorAgentId: string;
  acceptanceOwnerAgentId: string;
  responsibilityArtifactHash: string;
  status: "queued" | "leased" | "blocked" | "completed" | "failed" | "cancelled";
  dispatchedAt: string | null;
  startedAt: string | null;
  startDeadline: string;
  progressDeadline: string;
  completionDeadline: string;
  terminalEventId: string | null;
  effectDisposition: "not_started" | "known_safe_failure" | "uncertain" | "reconciled";
  recoveryDecisionCount: number;
  artifactHashes: string[];
  requiredVerificationSuiteIds: string[];
  verification: {
    suiteId: string;
    eventId: string;
    artifactHashes: string[];
    status: "passed" | "failed";
  }[];
  review: {
    eventId?: string;
    verdict: "accepted" | "rework" | "blocked";
    reviewerAgentId: string;
    acceptanceHash: string;
    artifactHashes: string[];
    verificationEventIds: string[];
  } | null;
  acceptanceHash: string;
}

export interface OutcomeSupervisionSnapshotV1 {
  schemaVersion: 1;
  supervisionId: string;
  projectId: string;
  workstreamId: string;
  workstreamRevision: number;
  sourceRevisionDigest: string;
  ownerAgentId: string;
  mandateHash: string;
  causationEventIds: string[];
  evidenceStatus: "valid" | "unavailable" | "conflict";
  workstreamStatus: "active" | "blocked" | "completed" | "cancelled";
  authorityStatus: "active" | "revoked" | "expired" | "unobserved";
  assignments: SupervisedAssignmentObservationV1[];
  /** Canonical assignments that still require an exact responsibility; never count as accepted. */
  unboundAssignmentIds?: string[];
  /** Rework-rejected assignments replaced by a later assignment; settled history, not work. */
  replacedAssignmentIds?: string[];
  escalationCount: number;
  pendingDecision: boolean;
  attentionPending?: boolean;
  /** When the earliest still-pending owner attention was recorded; null when none is pending. */
  attentionPendingSince?: string | null;
  delivery: "not_attempted" | "pending" | "failed" | "delivered";
  deliveryNextCheckAt?: string | null;
  /** One exhausted outbound can be replaced only when transport replay proves no send began. */
  deliveryRecoverySafe?: boolean;
  /** False only for a host that exposes the accepted local result without an external origin. */
  deliveryRequired?: boolean;
  /** Separate scoped receipts; none grants a foreign assignment lease or goal completion. */
  handoffs?: {
    pendingIncoming: string[];
    pendingOutgoing: string[];
    nextCheckAt: string | null;
  };
}

export interface OutcomeSupervisionReportV1 {
  schemaVersion: 1;
  kind: "work.supervision.report";
  supervisionId: string;
  sourceRevisionDigest: string;
  ownerAgentId: string;
  causationEventIds: string[];
  status:
    | "planning"
    | "awaiting_start"
    | "executing"
    | "reviewing"
    | "recovering"
    | "waiting_decision"
    /** Held as Lervo's own unresolved debt (ADR-0561); never owner work and never awaited. */
    | "lervo_debt"
    | "completed"
    | "cancelled"
    | "invalid";
  reasonCode: string;
  assignmentIds: string[];
  nextCheckAt: string | null;
  nextAction:
    | OperatingActionKind
    | "review_artifacts"
    | "complete_workstream"
    | "reconcile_cancellation"
    | null;
}
