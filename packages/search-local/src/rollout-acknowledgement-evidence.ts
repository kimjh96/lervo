import {
  assertSearchRolloutActionEligibility,
  createSearchRolloutQualitySnapshot,
  verifySearchRolloutReview,
  type SearchAssessment,
  type SearchAttempt,
  type SearchEngineActivation,
  type SearchRolloutKeepAcknowledgement,
  type SearchRolloutReview,
} from "@lervo/search";

import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import {
  assertRolloutActionReviewTarget,
  rolloutActionEvidenceThrough,
} from "./rollout-action-quality-evidence.js";
import { loadSearchRolloutActionPolicy } from "./rollout-action-policy-files.js";
import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import { loadStoredSearchRolloutReview } from "./rollout-review-store.js";
import { SearchLocalError } from "./types.js";

export async function verifySearchRolloutKeepAcknowledgementEvidence(input: {
  repositoryRoot: string;
  projectId: string;
  acknowledgement: SearchRolloutKeepAcknowledgement;
  history: readonly SearchEngineActivation[];
  attempts: readonly SearchAttempt[];
  assessments: readonly SearchAssessment[];
}): Promise<SearchRolloutReview> {
  const [actionPolicy, review] = await Promise.all([
    loadSearchRolloutActionPolicy(input.repositoryRoot, input.acknowledgement.actionPolicyId),
    loadStoredSearchRolloutReview(input.repositoryRoot, input.acknowledgement.rolloutReviewId),
  ]);
  const [rolloutPolicy, candidateReview] = await Promise.all([
    loadSearchRolloutReviewPolicy(input.repositoryRoot, actionPolicy.rolloutPolicyId),
    loadStoredSearchCandidateReview(input.repositoryRoot, review.target.candidateReviewId),
  ]);
  const targetActivation = input.history.find(
    (activation) => activation.activationId === review.target.selectionTransitionId,
  );
  if (targetActivation === undefined) {
    throw new SearchLocalError("observation_invalid", "The search selection transition for the candidate-retention acknowledgement was not found.");
  }
  assertRolloutActionReviewTarget(review, targetActivation, candidateReview);
  verifySearchRolloutReview(
    review,
    rolloutActionEvidenceThrough(
      review,
      input.attempts,
      input.assessments,
      new Date(review.reviewedAt),
    ),
  );
  const acknowledgedAt = new Date(input.acknowledgement.acknowledgedAt);
  const targetIndex = input.history.findIndex((activation) => activation.activationId === targetActivation.activationId);
  const targetWasHead = Date.parse(targetActivation.decidedAt) <= acknowledgedAt.getTime() &&
    input.history.slice(targetIndex + 1).every(
      (activation) => Date.parse(activation.decidedAt) >= acknowledgedAt.getTime(),
    );
  const actionEvidence = rolloutActionEvidenceThrough(review, input.attempts, input.assessments, acknowledgedAt);
  const qualitySnapshot = createSearchRolloutQualitySnapshot({
    projectId: input.projectId,
    target: review.target,
    attempts: actionEvidence.attempts,
    assessments: actionEvidence.assessments,
    observedThrough: acknowledgedAt,
  });
  assertSearchRolloutActionEligibility({
    actionPolicy,
    rolloutPolicy,
    review,
    currentQualitySnapshot: qualitySnapshot,
    currentSelectionTransitionId: targetWasHead ? targetActivation.activationId : null,
    operatorId: input.acknowledgement.operatorId,
    actedAt: acknowledgedAt,
  });
  if (input.acknowledgement.projectId !== input.projectId || actionPolicy.projectId !== input.projectId ||
    actionPolicy.action !== "acknowledge_keep" ||
    input.acknowledgement.actionPolicyId !== actionPolicy.actionPolicyId ||
    input.acknowledgement.rolloutPolicyId !== rolloutPolicy.policyId ||
    input.acknowledgement.rolloutReviewId !== review.rolloutReviewId ||
    input.acknowledgement.selectionTransitionId !== review.target.selectionTransitionId ||
    input.acknowledgement.qualitySnapshotId !== qualitySnapshot.snapshotId ||
    input.acknowledgement.qualityInputDigest !== qualitySnapshot.inputDigest) {
    throw new SearchLocalError("observation_invalid", "The policy, review, and quality evidence for the candidate-retention acknowledgement differs.");
  }
  return review;
}
