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
    throw new SearchError("engine_activation_not_eligible", "활성화 정책이 이 operator를 허용하지 않습니다.");
  }
}

export function assertSearchEngineActivationEvidence(input: {
  policy: SearchEngineActivationPolicy;
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
}): void {
  assertSearchCandidateReview(input.review);
  assertSearchEvaluationComparison(input.comparison);
  if (input.review.projectId !== input.policy.projectId || input.comparison.projectId !== input.policy.projectId ||
    input.review.comparisonId !== input.comparison.comparisonId ||
    !sameSearchEngine(input.review.candidate, input.comparison.candidate.engine) ||
    input.review.candidateRunId !== input.comparison.candidate.runId ||
    input.review.bundleId !== input.comparison.bundleId || input.review.bundleHash !== input.comparison.bundleHash ||
    input.review.coverageId !== input.comparison.coverageId ||
    input.review.corpusDigest !== input.comparison.corpusDigest ||
    input.review.totalCases !== input.comparison.totalCases ||
    input.review.baselineWins !== input.comparison.baselineWins ||
    input.review.candidateWins !== input.comparison.candidateWins || input.review.ties !== input.comparison.ties ||
    input.review.decision !== "adopt_candidate" ||
    input.review.promotionReadiness !== "eligible_for_activation_review" ||
    !input.policy.allowedReviewerIds.includes(input.review.reviewerId) ||
    !input.policy.allowedCandidateIds.includes(input.review.candidateId) ||
    input.review.candidateWins < input.policy.minimumCandidateWins ||
    input.review.baselineWins > input.policy.maximumBaselineWins) {
    throw new SearchError("engine_activation_not_eligible", "검토·비교 원본이 검색 엔진 활성화 정책을 충족하지 않습니다.");
  }
}
