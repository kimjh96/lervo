import {
  sameSearchEngine,
  type SearchAssessment,
  type SearchAttempt,
  type SearchCandidateReview,
  type SearchEngineActivation,
  type SearchRolloutReview,
} from "@lervo/search";

import { SearchLocalError } from "./types.js";

export function rolloutActionEvidenceThrough(
  review: SearchRolloutReview,
  attempts: readonly SearchAttempt[],
  assessments: readonly SearchAssessment[],
  through: Date,
) {
  const selectedAttempts = attempts.filter(
    (attempt) =>
      attempt.selectionTransitionId === review.target.selectionTransitionId &&
      Date.parse(attempt.observedAt) <= through.getTime(),
  );
  const attemptIds = new Set(selectedAttempts.map((attempt) => attempt.attemptId));
  return {
    attempts: selectedAttempts,
    assessments: assessments.filter(
      (assessment) =>
        attemptIds.has(assessment.attemptId) &&
        Date.parse(assessment.assessedAt) <= through.getTime(),
    ),
  };
}

export function assertRolloutActionReviewTarget(
  review: SearchRolloutReview,
  activation: SearchEngineActivation,
  candidateReview: SearchCandidateReview,
): void {
  if (
    activation.activationId !== review.target.selectionTransitionId ||
    activation.selected.mode !== "candidate" ||
    activation.selected.candidateId !== review.target.candidateId ||
    activation.selected.reviewId !== review.target.candidateReviewId ||
    !sameSearchEngine(activation.selected.engine, review.target.engine) ||
    candidateReview.schemaVersion !== 2 ||
    candidateReview.reviewId !== review.target.candidateReviewId ||
    candidateReview.candidateAdapterBuildId !== review.target.adapterBuildId
  ) {
    throw new SearchLocalError(
      "observation_invalid",
      "The rollout action review target differs from the source search selection.",
    );
  }
}
