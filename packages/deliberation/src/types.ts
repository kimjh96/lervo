import type {
  DeliberationArtifact,
  DeliberationOutcome,
  DeliberationPolicy,
  VerificationResult,
  VerificationSuite,
} from "@lervo/schemas";
import type { VerificationArtifactCoordinate } from "@lervo/verification";

export type DeliberationErrorCode =
  | "artifact_contract_invalid"
  | "history_contract_invalid"
  | "outcome_contract_invalid"
  | "policy_contract_invalid"
  | "verification_evidence_invalid";

export class DeliberationError extends Error {
  constructor(
    readonly code: DeliberationErrorCode,
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
