import { SEARCH_CANDIDATE_ID_PATTERN } from "./evaluation-engine-registry.js";
import { contentId } from "./integrity.js";
import type {
  SearchRolloutPolicyAssessment,
  SearchRolloutPolicyFailureReason,
  SearchRolloutReviewPolicy,
} from "./rollout-policy-types.js";
import { SEARCH_ROLLOUT_POLICY_PATTERN } from "./rollout-policy-types.js";
import { assertSearchRolloutReview } from "./rollout-review.js";
import type { SearchRolloutReview } from "./rollout-review-types.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

function orderedUnique(values: readonly string[], pattern: RegExp, maximum: number): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum ||
    values.some((value) => typeof value !== "string" || !pattern.test(value))) {
    throw new SearchError("invalid_rollout_policy", "검색 rollout 정책의 허용 목록이 유효하지 않습니다.");
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new SearchError("invalid_rollout_policy", "검색 rollout 정책의 허용 목록이 중복되었습니다.");
  }
  return sorted;
}

function validCount(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= 10_000;
}

export function createSearchRolloutReviewPolicy(input: {
  projectId: string;
  allowedReviewerIds: readonly string[];
  allowedCandidateIds: readonly string[];
  keepMinimumAssessedAttempts: number;
  keepMaximumFailedAttempts: number;
  rollbackMinimumAssessedAttempts: number;
  rollbackMinimumFailedAttempts: number;
  authoredBy: string;
  createdAt: Date;
}): SearchRolloutReviewPolicy {
  if (!SOURCE_ID_PATTERN.test(input.projectId) || !SOURCE_ID_PATTERN.test(input.authoredBy) ||
    !validCount(input.keepMinimumAssessedAttempts, 1) || !validCount(input.keepMaximumFailedAttempts, 0) ||
    !validCount(input.rollbackMinimumAssessedAttempts, 1) || !validCount(input.rollbackMinimumFailedAttempts, 1) ||
    input.keepMaximumFailedAttempts >= input.rollbackMinimumFailedAttempts ||
    input.rollbackMinimumFailedAttempts > input.rollbackMinimumAssessedAttempts ||
    !Number.isFinite(input.createdAt.getTime())) {
    throw new SearchError("invalid_rollout_policy", "검색 rollout 정책 입력과 판단 기준이 유효하지 않습니다.");
  }
  const core = {
    projectId: input.projectId,
    allowedReviewerIds: orderedUnique(input.allowedReviewerIds, SOURCE_ID_PATTERN, 32),
    allowedCandidateIds: orderedUnique(input.allowedCandidateIds, SEARCH_CANDIDATE_ID_PATTERN, 16),
    rules: {
      keepCandidate: {
        minimumAssessedAttempts: input.keepMinimumAssessedAttempts,
        maximumFailedAttempts: input.keepMaximumFailedAttempts,
      },
      rollbackRecommended: {
        minimumAssessedAttempts: input.rollbackMinimumAssessedAttempts,
        minimumFailedAttempts: input.rollbackMinimumFailedAttempts,
      },
      moreAssessmentsRequired: { allowed: true as const },
    },
    authoredBy: input.authoredBy,
    createdAt: input.createdAt.toISOString(),
  };
  if (!core.allowedReviewerIds.includes(input.authoredBy)) {
    throw new SearchError("invalid_rollout_policy", "정책 작성자는 허용 reviewer에 포함되어야 합니다.");
  }
  const policy: SearchRolloutReviewPolicy = {
    schemaVersion: 1,
    policyId: contentId("srpol", core),
    ...core,
  };
  assertSearchRolloutReviewPolicy(policy);
  return policy;
}

export function assertSearchRolloutReviewPolicy(policy: SearchRolloutReviewPolicy): void {
  if (policy.schemaVersion !== 1 || !SEARCH_ROLLOUT_POLICY_PATTERN.test(policy.policyId) ||
    !SOURCE_ID_PATTERN.test(policy.projectId) || !SOURCE_ID_PATTERN.test(policy.authoredBy) ||
    !validCount(policy.rules?.keepCandidate.minimumAssessedAttempts, 1) ||
    !validCount(policy.rules.keepCandidate.maximumFailedAttempts, 0) ||
    !validCount(policy.rules.rollbackRecommended.minimumAssessedAttempts, 1) ||
    !validCount(policy.rules.rollbackRecommended.minimumFailedAttempts, 1) ||
    policy.rules.keepCandidate.maximumFailedAttempts >= policy.rules.rollbackRecommended.minimumFailedAttempts ||
    policy.rules.rollbackRecommended.minimumFailedAttempts > policy.rules.rollbackRecommended.minimumAssessedAttempts ||
    policy.rules.moreAssessmentsRequired?.allowed !== true) {
    throw new SearchError("invalid_rollout_policy", "검색 rollout 정책 계약이 유효하지 않습니다.");
  }
  const reviewers = orderedUnique(policy.allowedReviewerIds, SOURCE_ID_PATTERN, 32);
  const candidates = orderedUnique(policy.allowedCandidateIds, SEARCH_CANDIDATE_ID_PATTERN, 16);
  if (JSON.stringify(reviewers) !== JSON.stringify(policy.allowedReviewerIds) ||
    JSON.stringify(candidates) !== JSON.stringify(policy.allowedCandidateIds) ||
    !reviewers.includes(policy.authoredBy)) {
    throw new SearchError("invalid_rollout_policy", "검색 rollout 정책의 정렬·작성자 좌표가 유효하지 않습니다.");
  }
  assertTimestamp(policy.createdAt, "invalid_rollout_policy");
  const { schemaVersion: _schema, policyId: _id, ...core } = policy;
  if (contentId("srpol", core) !== policy.policyId) {
    throw new SearchError("invalid_rollout_policy", "검색 rollout 정책 ID가 실제 내용과 다릅니다.");
  }
}

export function evaluateSearchRolloutReviewPolicy(
  policy: SearchRolloutReviewPolicy,
  review: SearchRolloutReview,
): SearchRolloutPolicyAssessment {
  assertSearchRolloutReviewPolicy(policy);
  assertSearchRolloutReview(review);
  if (policy.projectId !== review.projectId) {
    throw new SearchError("invalid_rollout_policy", "검색 rollout 정책과 검토의 project 좌표가 다릅니다.");
  }
  const bindingState = review.schemaVersion === 1
    ? "legacy_unbound" as const
    : review.rolloutPolicyId === policy.policyId ? "bound" as const : "different_policy" as const;
  const policyPrecedesReview = Date.parse(policy.createdAt) <= Date.parse(review.reviewedAt);
  const commonEligible = bindingState === "bound" && policyPrecedesReview &&
    policy.allowedReviewerIds.includes(review.reviewerId) &&
    policy.allowedCandidateIds.includes(review.target.candidateId);
  const keepEligible = commonEligible &&
    review.qualitySnapshot.assessedAttempts >= policy.rules.keepCandidate.minimumAssessedAttempts &&
    review.qualitySnapshot.failedAttempts <= policy.rules.keepCandidate.maximumFailedAttempts;
  const rollbackEligible = commonEligible &&
    review.qualitySnapshot.assessedAttempts >= policy.rules.rollbackRecommended.minimumAssessedAttempts &&
    review.qualitySnapshot.failedAttempts >= policy.rules.rollbackRecommended.minimumFailedAttempts;
  const moreEligible = commonEligible;
  const failureReasons = new Set<SearchRolloutPolicyFailureReason>();
  if (bindingState === "legacy_unbound") failureReasons.add("policy_not_bound");
  if (bindingState === "different_policy") failureReasons.add("policy_mismatch");
  if (!policyPrecedesReview) failureReasons.add("policy_created_after_review");
  if (!policy.allowedReviewerIds.includes(review.reviewerId)) failureReasons.add("reviewer_not_allowed");
  if (!policy.allowedCandidateIds.includes(review.target.candidateId)) failureReasons.add("candidate_not_allowed");
  if (review.decision === "keep_candidate") {
    if (review.qualitySnapshot.assessedAttempts < policy.rules.keepCandidate.minimumAssessedAttempts) {
      failureReasons.add("insufficient_assessed_attempts");
    }
    if (review.qualitySnapshot.failedAttempts > policy.rules.keepCandidate.maximumFailedAttempts) {
      failureReasons.add("too_many_failed_attempts");
    }
  } else if (review.decision === "rollback_recommended") {
    if (review.qualitySnapshot.assessedAttempts < policy.rules.rollbackRecommended.minimumAssessedAttempts) {
      failureReasons.add("insufficient_assessed_attempts");
    }
    if (review.qualitySnapshot.failedAttempts < policy.rules.rollbackRecommended.minimumFailedAttempts) {
      failureReasons.add("too_few_failed_attempts");
    }
  }
  const decisionEligible = review.decision === "keep_candidate"
    ? keepEligible
    : review.decision === "rollback_recommended" ? rollbackEligible : moreEligible;
  return {
    schemaVersion: 1,
    projectId: policy.projectId,
    policyId: policy.policyId,
    rolloutReviewId: review.rolloutReviewId,
    policyBindingState: bindingState,
    ruleOutcomes: {
      keepCandidate: keepEligible ? "eligible" : "ineligible",
      rollbackRecommended: rollbackEligible ? "eligible" : "ineligible",
      moreAssessmentsRequired: moreEligible ? "eligible" : "ineligible",
    },
    reviewDecisionEligibility: decisionEligible ? "eligible" : "ineligible",
    failureReasons: [...failureReasons].sort(),
    decisionSelection: "not_performed",
    effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
  };
}
