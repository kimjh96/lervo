import { assertSearchEngineActivationPolicy } from "./engine-activation-policy.js";
import type { SearchEngineActivationPolicy } from "./engine-activation-types.js";
import { assertSearchEvaluationComparison } from "./evaluation-comparison.js";
import type { SearchEvaluationComparison } from "./evaluation-comparison-types.js";
import { assertSearchCandidateReview } from "./evaluation-review.js";
import type { SearchCandidateReview } from "./evaluation-review-types.js";
import { sameSearchEngine } from "./evaluation-engine.js";
import { SearchError } from "./types.js";
import { SOURCE_ID_PATTERN } from "./validation.js";

export function assertSearchEngineActivationOperator(
  policy: SearchEngineActivationPolicy,
  operatorId: string,
): void {
  assertSearchEngineActivationPolicy(policy);
  if (!SOURCE_ID_PATTERN.test(operatorId) || !policy.allowedOperatorIds.includes(operatorId)) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "The activation policy does not allow this operator.",
    );
  }
}

export function assertSearchEngineActivationEvidence(input: {
  policy: SearchEngineActivationPolicy;
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
}): void {
  assertSearchCandidateReview(input.review);
  assertSearchEvaluationComparison(input.comparison);
  if (
    input.review.projectId !== input.policy.projectId ||
    input.comparison.projectId !== input.policy.projectId ||
    input.review.comparisonId !== input.comparison.comparisonId ||
    input.review.schemaVersion !== input.comparison.schemaVersion ||
    (input.review.schemaVersion === 2 &&
      input.comparison.schemaVersion === 2 &&
      input.review.candidateAdapterBuildId !== input.comparison.candidateAdapterBuildId) ||
    !sameSearchEngine(input.review.candidate, input.comparison.candidate.engine) ||
    input.review.candidateRunId !== input.comparison.candidate.runId ||
    input.review.bundleId !== input.comparison.bundleId ||
    input.review.bundleHash !== input.comparison.bundleHash ||
    input.review.coverageId !== input.comparison.coverageId ||
    input.review.corpusDigest !== input.comparison.corpusDigest ||
    input.review.totalCases !== input.comparison.totalCases ||
    input.review.baselineWins !== input.comparison.baselineWins ||
    input.review.candidateWins !== input.comparison.candidateWins ||
    input.review.ties !== input.comparison.ties ||
    input.review.decision !== "adopt_candidate" ||
    input.review.promotionReadiness !== "eligible_for_activation_review" ||
    !input.policy.allowedReviewerIds.includes(input.review.reviewerId) ||
    !input.policy.allowedCandidateIds.includes(input.review.candidateId) ||
    input.review.candidateWins < input.policy.minimumCandidateWins ||
    input.review.baselineWins > input.policy.maximumBaselineWins
  ) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "The review and comparison sources do not satisfy the search engine activation policy.",
    );
  }
}
