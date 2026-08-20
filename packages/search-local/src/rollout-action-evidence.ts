import {
  assertSearchRolloutActionEligibility,
  createSearchRolloutQualitySnapshot,
  verifySearchRolloutReview,
  type SearchAssessment,
  type SearchAttempt,
  type SearchEngineActivation,
  type SearchEngineRolloutRollback,
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
  assertRolloutActionReviewTarget(review, input.previous, candidateReview);
  verifySearchRolloutReview(
    review,
    rolloutActionEvidenceThrough(review, input.attempts, input.assessments, new Date(review.reviewedAt)),
  );
  const currentEvidence = rolloutActionEvidenceThrough(
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
