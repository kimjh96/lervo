import type {
  DeliberationArtifact,
  DeliberationOutcome,
  DeliberationPolicy,
  VerificationResult,
  VerificationSuite,
} from "@lervo/schemas";
import type { VerificationArtifactCoordinate } from "@lervo/verification-contract";

export type DeliberationErrorCode =
  | "artifact_contract_invalid"
  | "history_contract_invalid"
  | "outcome_contract_invalid"
  | "policy_contract_invalid"
  | "verification_evidence_invalid";

export type DeliberationErrorReason =
  | "artifact_id_mismatch"
  | "artifact_order_invalid"
  | "artifact_policy_mismatch"
  | "artifact_schema_invalid"
  | "adopted_claim_unverified"
  | "blocking_objection_unresolved"
  | "content_coordinate_mismatch"
  | "context_receipt_overlap"
  | "cross_role_receipt_reuse"
  | "cross_role_run_reuse"
  | "cross_role_session_reuse"
  | "decision_claim_invalid"
  | "decision_missing"
  | "decision_not_terminal"
  | "decision_owner_mismatch"
  | "decision_verification_mismatch"
  | "duplicate_claim"
  | "duplicate_decision"
  | "duplicate_objection"
  | "history_coordinate_mismatch"
  | "independent_review_missing"
  | "no_consensus_reason_mismatch"
  | "objection_state_mismatch"
  | "outcome_coordinate_mismatch"
  | "outcome_schema_invalid"
  | "policy_role_assignment_invalid"
  | "policy_schema_invalid"
  | "provider_not_allowed"
  | "previous_artifact_context_missing"
  | "revision_link_invalid"
  | "revision_resolution_invalid"
  | "required_verification_missing"
  | "role_responsibility_mismatch"
  | "stale_claim_verification"
  | "timestamp_invalid"
  | "unexpected_verification_evidence"
  | "verification_coordinate_mismatch"
  | "verification_evidence_duplicate"
  | "verification_result_invalid"
  | "writing_permit_mismatch";

export class DeliberationError extends Error {
  constructor(
    readonly code: DeliberationErrorCode,
    readonly reason: DeliberationErrorReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeliberationError";
  }
}

export interface DeliberationVerificationEvidence {
  suite: VerificationSuite;
  result: VerificationResult;
  resultArtifact: VerificationArtifactCoordinate;
}

export interface ValidateDeliberationOutcomeInput {
  deliberationId: string;
  policy: DeliberationPolicy;
  artifacts: readonly DeliberationArtifact[];
  verificationEvidence: readonly DeliberationVerificationEvidence[];
  outcome: DeliberationOutcome;
}
