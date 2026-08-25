import {
  createSearchRolloutQualitySnapshot,
  createSearchRolloutStatusPage,
  verifySearchRolloutReview,
  type SearchRolloutQualitySnapshot,
  type SearchRolloutStatusEvidence,
  type SearchRolloutStatusPage,
} from "@lervo/search";

import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { listStoredSearchRolloutReviews } from "./rollout-review-store.js";
import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import {
  assertRolloutReviewTarget,
  createRolloutCurrentSelection,
  rolloutAttemptEvidence,
} from "./rollout-review-state.js";
import { loadVerifiedSearchSelectionQualityEvidence } from "./selection-quality-evidence.js";
import { SearchLocalError } from "./types.js";

export async function readLocalSearchRolloutStatus(input: {
  repositoryRoot: string;
  projectId: string;
  observedAt: Date;
  limit?: number;
  cursor?: string;
}): Promise<SearchRolloutStatusPage> {
  const [qualityEvidence, reviews] = await Promise.all([
    loadVerifiedSearchSelectionQualityEvidence(input),
    listStoredSearchRolloutReviews(input.repositoryRoot),
  ]);
  const current = qualityEvidence.history.at(-1);
  const candidateReviewIds = new Set(reviews.map((review) => review.target.candidateReviewId));
  if (current?.selected.mode === "candidate") candidateReviewIds.add(current.selected.reviewId);
  const candidateReviews = new Map(
    await Promise.all(
      [...candidateReviewIds].map(
        async (reviewId) =>
          [
            reviewId,
            await loadStoredSearchCandidateReview(input.repositoryRoot, reviewId),
          ] as const,
      ),
    ),
  );
  const policyIds = new Set(
    reviews.flatMap((review) => (review.schemaVersion === 2 ? [review.rolloutPolicyId] : [])),
  );
  const rolloutPolicies = new Map(
    await Promise.all(
      [...policyIds].map(
        async (policyId) =>
          [policyId, await loadSearchRolloutReviewPolicy(input.repositoryRoot, policyId)] as const,
      ),
    ),
  );
  const selection = createRolloutCurrentSelection(qualityEvidence.history, candidateReviews);
  const activations = new Map(
    qualityEvidence.history.map((activation) => [activation.activationId, activation]),
  );
  const currentSnapshots = new Map<string, SearchRolloutQualitySnapshot>();
  const statusEvidence: SearchRolloutStatusEvidence[] = [];
  for (const review of reviews) {
    if (review.projectId !== input.projectId) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search rollout review has different project coordinates.",
      );
    }
    if (
      review.schemaVersion === 2 &&
      rolloutPolicies.get(review.rolloutPolicyId)?.projectId !== input.projectId
    ) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search rollout review policy has different project coordinates.",
      );
    }
    const candidateReview = candidateReviews.get(review.target.candidateReviewId)!;
    assertRolloutReviewTarget(
      review,
      activations.get(review.target.selectionTransitionId),
      candidateReview,
    );
    verifySearchRolloutReview(
      review,
      rolloutAttemptEvidence(
        review,
        qualityEvidence.attempts,
        qualityEvidence.assessments,
        new Date(review.reviewedAt),
      ),
    );
    let snapshot = currentSnapshots.get(review.target.selectionTransitionId);
    if (snapshot === undefined) {
      const currentEvidence = rolloutAttemptEvidence(
        review,
        qualityEvidence.attempts,
        qualityEvidence.assessments,
      );
      snapshot = createSearchRolloutQualitySnapshot({
        projectId: input.projectId,
        target: review.target,
        attempts: currentEvidence.attempts,
        assessments: currentEvidence.assessments,
        observedThrough: input.observedAt,
      });
      currentSnapshots.set(review.target.selectionTransitionId, snapshot);
    }
    statusEvidence.push({ review, currentQualitySnapshot: snapshot });
  }
  return createSearchRolloutStatusPage({
    projectId: input.projectId,
    observedAt: input.observedAt,
    currentSelection: selection,
    evidence: statusEvidence,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}
