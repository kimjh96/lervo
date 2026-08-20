import {
  createSearchRolloutReview,
  type SearchRolloutReview,
  type SearchRolloutReviewDecision,
} from "@lervo/search";

import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { recordSearchRolloutReview } from "./rollout-review-store.js";
import { loadVerifiedSearchSelectionQualityEvidence } from "./selection-quality-evidence.js";
import { SearchLocalError } from "./types.js";

export async function reviewLocalSearchRollout(input: {
  repositoryRoot: string;
  projectId: string;
  selectionTransitionId: string;
  reviewerId: string;
  reviewedAt: Date;
  decision: SearchRolloutReviewDecision;
}): Promise<SearchRolloutReview> {
  const evidence = await loadVerifiedSearchSelectionQualityEvidence(input);
  const current = evidence.history.at(-1);
  if (current === undefined || current.activationId !== input.selectionTransitionId ||
    current.selected.mode !== "candidate") {
    throw new SearchLocalError(
      "rollout_review_not_eligible",
      "현재 선택된 후보 검색 엔진의 전이만 rollout 검토할 수 있습니다.",
    );
  }
  const review = await loadStoredSearchCandidateReview(input.repositoryRoot, current.selected.reviewId);
  if (review.schemaVersion !== 2) {
    throw new SearchLocalError(
      "rollout_review_not_eligible",
      "Adapter build에 결속되지 않은 기존 후보 검토는 rollout 검토할 수 없습니다.",
    );
  }
  const attempts = evidence.attempts.filter(
    (attempt) => attempt.selectionTransitionId === current.activationId,
  );
  if (attempts.length === 0) {
    throw new SearchLocalError(
      "rollout_review_not_eligible",
      "현재 후보 선택에서 기록된 검색 시도가 없어 rollout 검토를 만들 수 없습니다.",
    );
  }
  const attemptIds = new Set(attempts.map((attempt) => attempt.attemptId));
  const assessments = evidence.assessments.filter((assessment) => attemptIds.has(assessment.attemptId));
  const rolloutReview = createSearchRolloutReview({
    projectId: input.projectId,
    target: {
      selectionTransitionId: current.activationId,
      candidateId: current.selected.candidateId,
      engine: { ...current.selected.engine },
      adapterBuildId: review.candidateAdapterBuildId,
      candidateReviewId: review.reviewId,
    },
    attempts,
    assessments,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    decision: input.decision,
  });
  await recordSearchRolloutReview(input.repositoryRoot, rolloutReview);
  return rolloutReview;
}
