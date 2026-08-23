import { validateSchema } from "@lervo/schemas";

import { analyzeDeliberationHistory } from "./history-validation.js";
import {
  calculateDeliberationOutcomeId,
  deliberationPolicyHash,
} from "./integrity.js";
import { validateDeliberationPolicy } from "./policy-validation.js";
import {
  DeliberationError,
  type DeliberationErrorReason,
  type ValidateDeliberationOutcomeInput,
} from "./types.js";

function exactArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function requiredVerificationsPassed(
  required: readonly string[],
  passed: ReadonlySet<string>,
): boolean {
  return required.every((suiteId) => passed.has(suiteId));
}

function outcomeInvalid(
  reason: DeliberationErrorReason,
  message: string,
): never {
  throw new DeliberationError("outcome_contract_invalid", reason, message);
}

export function validateDeliberationOutcome(
  input: ValidateDeliberationOutcomeInput,
): void {
  validateDeliberationPolicy(input.policy);
  if (!validateSchema("deliberationOutcome", input.outcome).valid) {
    throw new DeliberationError(
      "outcome_contract_invalid",
      "outcome_schema_invalid",
      "The deliberation outcome does not satisfy its schema.",
    );
  }
  const analysis = analyzeDeliberationHistory(input);
  const outcome = input.outcome;
  const completedAt = Date.parse(outcome.completedAt);
  const lastCreatedAt = input.artifacts.length === 0
    ? Number.NEGATIVE_INFINITY
    : Date.parse(input.artifacts.at(-1)!.createdAt);
  const expectedLastRound = input.artifacts.length === 0 ? 1 : analysis.lastRound;
  if (
    outcome.projectId !== input.policy.projectId || outcome.policyId !== input.policy.policyId ||
    outcome.policyHash !== deliberationPolicyHash(input.policy) ||
    outcome.deliberationId !== input.deliberationId ||
    (input.artifacts.length > 0 && outcome.deliberationId !== analysis.deliberationId) ||
    outcome.lastRound !== expectedLastRound ||
    !exactArray(outcome.artifactIds, analysis.artifactIds) ||
    outcome.lastConfirmedArtifactId !== analysis.lastArtifactId ||
    !Number.isFinite(completedAt) || completedAt < lastCreatedAt ||
    outcome.outcomeId !== calculateDeliberationOutcomeId(outcome) ||
    !exactArray(
      outcome.passedVerificationArtifactIds,
      analysis.passedVerificationArtifactIds,
    ) ||
    !exactArray(
      outcome.unresolvedBlockingObjectionIds,
      analysis.openBlockingObjectionIds,
    )
  ) {
    throw new DeliberationError(
      "outcome_contract_invalid",
      "outcome_coordinate_mismatch",
      "The deliberation outcome policy, artifact, round, verification, or objection coordinates differ from the actual history.",
    );
  }
  const passedRequired = requiredVerificationsPassed(
    input.policy.requiredVerificationSuiteIds,
    analysis.passedVerificationSuiteIds,
  );
  if (outcome.status === "converged") {
    const adoptedClaimsVerified = analysis.decision !== null &&
      input.policy.requiredVerificationSuiteIds.every((suiteId) => {
        const coveredClaims = analysis.passedClaimIdsBySuite.get(suiteId);
        return coveredClaims !== undefined && analysis.decision!.details.adoptedClaimIds.every(
          (claimId) => coveredClaims.has(claimId),
        );
      });
    if (
      analysis.decision === null ||
      outcome.decisionArtifactId !== analysis.decision.deliberationArtifactId
    ) outcomeInvalid("decision_missing", "The decision owner's final decision is missing.");
    if (analysis.openBlockingObjectionIds.length !== 0) {
      outcomeInvalid("blocking_objection_unresolved", "An unresolved blocking objection remains.");
    }
    if (!passedRequired) {
      outcomeInvalid("required_verification_missing", "A required verification suite has not passed.");
    }
    if (!analysis.independentReviewApproved) {
      outcomeInvalid("independent_review_missing", "The latest proposal or revision lacks independent approval.");
    }
    if (!adoptedClaimsVerified) {
      outcomeInvalid("adopted_claim_unverified", "The adopted current claim version has not been verified by every required suite.");
    }
    return;
  }
  if (outcome.status === "no_consensus") {
    if (analysis.decision !== null) {
      throw new DeliberationError(
        "outcome_contract_invalid",
        "no_consensus_reason_mismatch",
        "A history containing a decision artifact cannot be recorded as no_consensus.",
      );
    }
    const reasonMatches =
      (outcome.noConsensusReason === "max_rounds_reached" &&
        outcome.lastRound === input.policy.maxRounds) ||
      (outcome.noConsensusReason === "blocking_objections_unresolved" &&
        analysis.openBlockingObjectionIds.length > 0) ||
      (outcome.noConsensusReason === "required_verification_not_passed" && !passedRequired);
    if (!reasonMatches) {
      throw new DeliberationError(
        "outcome_contract_invalid",
        "no_consensus_reason_mismatch",
        "The no_consensus termination reason does not match the actual round, objection, or verification state.",
      );
    }
  }
}
