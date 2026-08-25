import {
  createSearchRolloutReview,
  evaluateSearchRolloutReviewPolicy,
  type SearchRolloutReview,
  type SearchRolloutReviewDecision,
} from "@lervo/search";

import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { recordSearchRolloutReview } from "./rollout-review-store.js";
import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import { loadVerifiedSearchSelectionQualityEvidence } from "./selection-quality-evidence.js";
import { SearchLocalError } from "./types.js";

export async function reviewLocalSearchRollout(input: {
  repositoryRoot: string;
  projectId: string;
  selectionTransitionId: string;
  reviewerId: string;
  reviewedAt: Date;
  decision: SearchRolloutReviewDecision;
  policyId?: string;
}): Promise<SearchRolloutReview> {
  const evidence = await loadVerifiedSearchSelectionQualityEvidence(input);
  const current = evidence.history.at(-1);
  if (
    current === undefined ||
    current.activationId !== input.selectionTransitionId ||
    current.selected.mode !== "candidate"
  ) {
    throw new SearchLocalError(
      "rollout_review_not_eligible",
      "Only the transition of the currently selected candidate search engine can be reviewed for rollout.",
    );
  }
  const review = await loadStoredSearchCandidateReview(
    input.repositoryRoot,
    current.selected.reviewId,
  );
  if (review.schemaVersion !== 2) {
    throw new SearchLocalError(
      "rollout_review_not_eligible",
      "A legacy candidate review that is not bound to an adapter build cannot be reviewed for rollout.",
    );
  }
  const attempts = evidence.attempts.filter(
    (attempt) => attempt.selectionTransitionId === current.activationId,
  );
  if (attempts.length === 0) {
    throw new SearchLocalError(
      "rollout_review_not_eligible",
      "A rollout review cannot be created because no search attempts were recorded for the current candidate selection.",
    );
  }
  const attemptIds = new Set(attempts.map((attempt) => attempt.attemptId));
  const assessments = evidence.assessments.filter((assessment) =>
    attemptIds.has(assessment.attemptId),
  );
  const rolloutPolicy =
    input.policyId === undefined
      ? null
      : await loadSearchRolloutReviewPolicy(input.repositoryRoot, input.policyId);
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
    ...(rolloutPolicy === null ? {} : { rolloutPolicyId: rolloutPolicy.policyId }),
  });
  if (rolloutPolicy !== null) {
    const assessment = evaluateSearchRolloutReviewPolicy(rolloutPolicy, rolloutReview);
    if (assessment.reviewDecisionEligibility !== "eligible") {
      throw new SearchLocalError(
        "rollout_review_not_eligible",
        `The search rollout review does not satisfy the policy criteria: ${assessment.failureReasons.join(", ")}`,
      );
    }
  }
  await recordSearchRolloutReview(input.repositoryRoot, rolloutReview);
  return rolloutReview;
}
