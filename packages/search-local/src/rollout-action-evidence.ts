import {
  assertSearchRolloutActionEligibility,
  createSearchRolloutQualitySnapshot,
  sameSearchEngine,
  verifySearchRolloutReview,
  type SearchAssessment,
  type SearchAttempt,
  type SearchCandidateReview,
  type SearchEngineActivation,
  type SearchEngineRolloutRollback,
  type SearchRolloutReview,
} from "@lervo/search";

import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { loadSearchRolloutActionPolicy } from "./rollout-action-policy-files.js";
import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import { loadStoredSearchRolloutReview } from "./rollout-review-store.js";
import { SearchLocalError } from "./types.js";

function evidenceThrough(
  review: SearchRolloutReview,
  attempts: readonly SearchAttempt[],
  assessments: readonly SearchAssessment[],
  through: Date,
) {
  const selectedAttempts = attempts.filter((attempt) =>
    attempt.selectionTransitionId === review.target.selectionTransitionId &&
    Date.parse(attempt.observedAt) <= through.getTime());
  const attemptIds = new Set(selectedAttempts.map((attempt) => attempt.attemptId));
  return {
    attempts: selectedAttempts,
    assessments: assessments.filter((assessment) =>
      attemptIds.has(assessment.attemptId) && Date.parse(assessment.assessedAt) <= through.getTime()),
  };
}

function assertTarget(
  review: SearchRolloutReview,
  previous: SearchEngineActivation,
  candidateReview: SearchCandidateReview,
): void {
  if (previous.activationId !== review.target.selectionTransitionId || previous.selected.mode !== "candidate" ||
    previous.selected.candidateId !== review.target.candidateId ||
    previous.selected.reviewId !== review.target.candidateReviewId ||
    !sameSearchEngine(previous.selected.engine, review.target.engine) || candidateReview.schemaVersion !== 2 ||
    candidateReview.reviewId !== review.target.candidateReviewId ||
    candidateReview.candidateAdapterBuildId !== review.target.adapterBuildId) {
    throw new SearchLocalError("observation_invalid", "Rollout rollback 검토 대상이 이전 검색 선택과 다릅니다.");
  }
}

export async function verifySearchRolloutRollbackEvidence(input: {
  repositoryRoot: string;
  projectId: string;
  activation: SearchEngineRolloutRollback;
  previous: SearchEngineActivation;
  attempts: readonly SearchAttempt[];
  assessments: readonly SearchAssessment[];
}): Promise<void> {
  const [actionPolicy, review] = await Promise.all([
    loadSearchRolloutActionPolicy(input.repositoryRoot, input.activation.rolloutAction.actionPolicyId),
    loadStoredSearchRolloutReview(input.repositoryRoot, input.activation.rolloutAction.rolloutReviewId),
  ]);
  const [rolloutPolicy, candidateReview] = await Promise.all([
    loadSearchRolloutReviewPolicy(input.repositoryRoot, actionPolicy.rolloutPolicyId),
    loadStoredSearchCandidateReview(input.repositoryRoot, review.target.candidateReviewId),
  ]);
  if (actionPolicy.projectId !== input.projectId || actionPolicy.action !== "execute_rollback" ||
    actionPolicy.engineActivationPolicyId !== input.activation.policyId ||
    actionPolicy.rolloutPolicyId !== input.activation.rolloutAction.rolloutPolicyId ||
    review.rolloutReviewId !== input.activation.rolloutAction.rolloutReviewId) {
    throw new SearchLocalError("observation_invalid", "Rollout rollback 정책·검토 좌표가 전이 근거와 다릅니다.");
  }
  assertTarget(review, input.previous, candidateReview);
  verifySearchRolloutReview(
    review,
    evidenceThrough(review, input.attempts, input.assessments, new Date(review.reviewedAt)),
  );
  const currentEvidence = evidenceThrough(
    review,
    input.attempts,
    input.assessments,
    new Date(input.activation.decidedAt),
  );
  const currentQualitySnapshot = createSearchRolloutQualitySnapshot({
    projectId: input.projectId,
    target: review.target,
    attempts: currentEvidence.attempts,
    assessments: currentEvidence.assessments,
    observedThrough: new Date(input.activation.decidedAt),
  });
  assertSearchRolloutActionEligibility({
    actionPolicy,
    rolloutPolicy,
    review,
    currentQualitySnapshot,
    currentSelectionTransitionId: input.previous.activationId,
    operatorId: input.activation.operatorId,
    actedAt: new Date(input.activation.decidedAt),
  });
  if (currentQualitySnapshot.snapshotId !== input.activation.rolloutAction.qualitySnapshotId ||
    currentQualitySnapshot.inputDigest !== input.activation.rolloutAction.qualityInputDigest) {
    throw new SearchLocalError("observation_invalid", "Rollout rollback 품질 입력이 전이 근거와 다릅니다.");
  }
}
