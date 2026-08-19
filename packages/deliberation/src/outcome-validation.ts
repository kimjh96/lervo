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
      "숙의 종료 결과가 schema를 통과하지 못했습니다.",
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
      "숙의 종료 결과의 정책, artifact, 회차, 검증 또는 반론 좌표가 실제 이력과 다릅니다.",
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
    ) outcomeInvalid("decision_missing", "결정 책임자의 마지막 decision이 없습니다.");
    if (analysis.openBlockingObjectionIds.length !== 0) {
      outcomeInvalid("blocking_objection_unresolved", "해소되지 않은 차단 반론이 있습니다.");
    }
    if (!passedRequired) {
      outcomeInvalid("required_verification_missing", "필수 verification suite가 통과하지 않았습니다.");
    }
    if (!analysis.independentReviewApproved) {
      outcomeInvalid("independent_review_missing", "최신 proposal 또는 revision의 독립 승인이 없습니다.");
    }
    if (!adoptedClaimsVerified) {
      outcomeInvalid("adopted_claim_unverified", "채택한 현재 주장 버전이 모든 필수 suite에서 검증되지 않았습니다.");
    }
    return;
  }
  if (outcome.status === "no_consensus") {
    if (analysis.decision !== null) {
      throw new DeliberationError(
        "outcome_contract_invalid",
        "no_consensus_reason_mismatch",
        "Decision artifact가 있는 이력을 no_consensus로 기록할 수 없습니다.",
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
        "no_consensus 종료 사유가 실제 회차, 반론 또는 검증 상태와 다릅니다.",
      );
    }
  }
}
