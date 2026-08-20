import { canonicalHash, contentId } from "./integrity.js";
import {
  assertSearchRolloutQualitySnapshot,
  assertSearchRolloutReviewTarget,
  createSearchRolloutQualitySnapshot,
} from "./rollout-quality-snapshot.js";
import {
  searchRolloutReviewDecisions,
  type SearchRolloutReview,
  type SearchRolloutReviewDecision,
  type SearchRolloutReviewTarget,
} from "./rollout-review-types.js";
import { SearchError, type SearchAssessment, type SearchAttempt } from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ROLLOUT_REVIEW_PATTERN = /^srrv_[a-f0-9]{24}$/;

export function createSearchRolloutReview(input: {
  projectId: string;
  target: SearchRolloutReviewTarget;
  attempts: readonly SearchAttempt[];
  assessments: readonly SearchAssessment[];
  reviewerId: string;
  reviewedAt: Date;
  decision: SearchRolloutReviewDecision;
}): SearchRolloutReview {
  if (!SOURCE_ID_PATTERN.test(input.reviewerId) || !searchRolloutReviewDecisions.includes(input.decision)) {
    throw new SearchError("invalid_rollout_review", "검색 rollout 검토 입력이 유효하지 않습니다.");
  }
  const qualitySnapshot = createSearchRolloutQualitySnapshot({
    projectId: input.projectId,
    target: input.target,
    attempts: input.attempts,
    assessments: input.assessments,
    observedThrough: input.reviewedAt,
  });
  const core = {
    projectId: input.projectId,
    target: structuredClone(input.target),
    qualitySnapshot,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt.toISOString(),
    decision: input.decision,
    thresholdPolicyState: "not_defined" as const,
    effect: {
      selectionChange: "not_applied" as const,
      rollback: "not_executed" as const,
      approval: "not_granted" as const,
    },
    embeddingDecision: "not_determined" as const,
  };
  const review: SearchRolloutReview = {
    schemaVersion: 1,
    rolloutReviewId: contentId("srrv", core),
    ...core,
  };
  assertSearchRolloutReview(review);
  return review;
}

export function assertSearchRolloutReview(review: SearchRolloutReview): void {
  if (review.schemaVersion !== 1 || !SEARCH_ROLLOUT_REVIEW_PATTERN.test(review.rolloutReviewId) ||
    !SOURCE_ID_PATTERN.test(review.projectId) || !SOURCE_ID_PATTERN.test(review.reviewerId) ||
    !searchRolloutReviewDecisions.includes(review.decision) || review.thresholdPolicyState !== "not_defined" ||
    review.effect?.selectionChange !== "not_applied" || review.effect.rollback !== "not_executed" ||
    review.effect.approval !== "not_granted" || review.embeddingDecision !== "not_determined") {
    throw new SearchError("invalid_rollout_review", "검색 rollout 검토 계약이 유효하지 않습니다.");
  }
  assertSearchRolloutReviewTarget(review.target);
  assertSearchRolloutQualitySnapshot(review.qualitySnapshot);
  assertTimestamp(review.reviewedAt, "invalid_rollout_review");
  if (review.reviewedAt !== review.qualitySnapshot.observedThrough) {
    throw new SearchError("invalid_rollout_review", "검색 rollout 검토와 품질 snapshot 시각이 다릅니다.");
  }
  const { schemaVersion: _schema, rolloutReviewId: _id, ...core } = review;
  if (contentId("srrv", core) !== review.rolloutReviewId) {
    throw new SearchError("invalid_rollout_review", "검색 rollout 검토 ID가 실제 내용과 다릅니다.");
  }
}

export function verifySearchRolloutReview(
  review: SearchRolloutReview,
  evidence: { attempts: readonly SearchAttempt[]; assessments: readonly SearchAssessment[] },
): void {
  assertSearchRolloutReview(review);
  const recreated = createSearchRolloutReview({
    projectId: review.projectId,
    target: review.target,
    attempts: evidence.attempts,
    assessments: evidence.assessments,
    reviewerId: review.reviewerId,
    reviewedAt: new Date(review.reviewedAt),
    decision: review.decision,
  });
  if (canonicalHash(recreated) !== canonicalHash(review)) {
    throw new SearchError("invalid_rollout_review", "검색 rollout 검토가 원본 품질 입력과 일치하지 않습니다.");
  }
}
