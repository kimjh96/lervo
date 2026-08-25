import {
  createSearchRolloutActionStatusPage,
  createSearchRolloutQualitySnapshot,
  type SearchRolloutActionStatusEvidence,
  type SearchRolloutActionStatusPage,
  type SearchRolloutReview,
} from "@lervo/search";

import { listStoredSearchRolloutKeepAcknowledgements } from "./rollout-acknowledgement-store.js";
import { verifySearchRolloutKeepAcknowledgementEvidence } from "./rollout-acknowledgement-evidence.js";
import { rolloutActionEvidenceThrough } from "./rollout-action-quality-evidence.js";
import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { loadStoredSearchRolloutReview } from "./rollout-review-store.js";
import { createRolloutCurrentSelection } from "./rollout-review-state.js";
import { loadVerifiedSearchSelectionQualityEvidence } from "./selection-quality-evidence.js";
import { SearchLocalError } from "./types.js";

export async function readLocalSearchRolloutActionStatus(input: {
  repositoryRoot: string;
  projectId: string;
  observedAt: Date;
  limit?: number;
  cursor?: string;
}): Promise<SearchRolloutActionStatusPage> {
  const [qualityEvidence, acknowledgements] = await Promise.all([
    loadVerifiedSearchSelectionQualityEvidence(input),
    listStoredSearchRolloutKeepAcknowledgements(input.repositoryRoot),
  ]);
  const reviews = new Map<string, SearchRolloutReview>();
  for (const acknowledgement of acknowledgements) {
    const review = await verifySearchRolloutKeepAcknowledgementEvidence({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      acknowledgement,
      history: qualityEvidence.history,
      attempts: qualityEvidence.attempts,
      assessments: qualityEvidence.assessments,
    });
    reviews.set(review.rolloutReviewId, review);
  }
  const rollbacks = qualityEvidence.history.filter((activation) => activation.schemaVersion === 3);
  for (const rollback of rollbacks) {
    const reviewId = rollback.rolloutAction.rolloutReviewId;
    if (!reviews.has(reviewId)) {
      reviews.set(reviewId, await loadStoredSearchRolloutReview(input.repositoryRoot, reviewId));
    }
  }
  const current = qualityEvidence.history.at(-1);
  const candidateReviews = new Map();
  if (current?.selected.mode === "candidate") {
    candidateReviews.set(
      current.selected.reviewId,
      await loadStoredSearchCandidateReview(input.repositoryRoot, current.selected.reviewId),
    );
  }
  const currentSelection = createRolloutCurrentSelection(qualityEvidence.history, candidateReviews);
  const records = [...acknowledgements, ...rollbacks];
  const evidence: SearchRolloutActionStatusEvidence[] = records.map((record) => {
    const reviewId =
      record.schemaVersion === 1 ? record.rolloutReviewId : record.rolloutAction.rolloutReviewId;
    const review = reviews.get(reviewId);
    if (review === undefined || review.projectId !== input.projectId) {
      throw new SearchLocalError(
        "observation_invalid",
        "The review source for the search rollout action was not found.",
      );
    }
    const currentEvidence = rolloutActionEvidenceThrough(
      review,
      qualityEvidence.attempts,
      qualityEvidence.assessments,
      input.observedAt,
    );
    return {
      record,
      review,
      currentQualitySnapshot: createSearchRolloutQualitySnapshot({
        projectId: input.projectId,
        target: review.target,
        attempts: currentEvidence.attempts,
        assessments: currentEvidence.assessments,
        observedThrough: input.observedAt,
      }),
    };
  });
  return createSearchRolloutActionStatusPage({
    projectId: input.projectId,
    observedAt: input.observedAt,
    currentSelection,
    evidence,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}
