import {
  assertSearchRolloutActionEligibility,
  createSearchRolloutKeepAcknowledgement,
  type SearchCandidateEngineResolver,
  type SearchEngineRolloutRollback,
  type SearchRolloutActionKind,
  type SearchRolloutKeepAcknowledgement,
} from "@lervo/search";

import { rollbackLocalSearchCandidate } from "./engine-activation-runner.js";
import { recordSearchRolloutKeepAcknowledgement } from "./rollout-acknowledgement-store.js";
import { loadSearchRolloutActionPolicy } from "./rollout-action-policy-files.js";
import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import { loadVerifiedLocalSearchRolloutReviewState } from "./rollout-review-state.js";
import { SearchLocalError } from "./types.js";

export async function applyLocalSearchRolloutAction(input: {
  repositoryRoot: string;
  projectId: string;
  rolloutReviewId: string;
  actionPolicyId: string;
  requestedAction: SearchRolloutActionKind;
  operatorId: string;
  actedAt: Date;
  registry: SearchCandidateEngineResolver;
}): Promise<SearchRolloutKeepAcknowledgement | SearchEngineRolloutRollback> {
  const [actionPolicy, state] = await Promise.all([
    loadSearchRolloutActionPolicy(input.repositoryRoot, input.actionPolicyId),
    loadVerifiedLocalSearchRolloutReviewState({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      rolloutReviewId: input.rolloutReviewId,
      observedAt: input.actedAt,
    }),
  ]);
  if (actionPolicy.projectId !== input.projectId || actionPolicy.action !== input.requestedAction) {
    throw new SearchLocalError(
      "rollout_action_not_eligible",
      "검색 rollout 조치 정책의 project·요청 조치가 다릅니다.",
    );
  }
  const rolloutPolicy = await loadSearchRolloutReviewPolicy(
    input.repositoryRoot,
    actionPolicy.rolloutPolicyId,
  );
  if (actionPolicy.action === "acknowledge_keep") {
    const acknowledgement = createSearchRolloutKeepAcknowledgement({
      actionPolicy,
      rolloutPolicy,
      ...state,
      operatorId: input.operatorId,
      acknowledgedAt: input.actedAt,
    });
    await recordSearchRolloutKeepAcknowledgement(input.repositoryRoot, acknowledgement);
    return acknowledgement;
  }
  assertSearchRolloutActionEligibility({
    actionPolicy,
    rolloutPolicy,
    ...state,
    operatorId: input.operatorId,
    actedAt: input.actedAt,
  });
  const activation = await rollbackLocalSearchCandidate({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    policyId: actionPolicy.engineActivationPolicyId!,
    operatorId: input.operatorId,
    decidedAt: input.actedAt,
    registry: input.registry,
    expectedPreviousActivationId: state.review.target.selectionTransitionId,
    rolloutAction: {
      actionPolicyId: actionPolicy.actionPolicyId,
      rolloutPolicyId: rolloutPolicy.policyId,
      rolloutReviewId: state.review.rolloutReviewId,
      qualitySnapshotId: state.currentQualitySnapshot.snapshotId,
      qualityInputDigest: state.currentQualitySnapshot.inputDigest,
    },
  });
  if (activation.schemaVersion !== 3) {
    throw new SearchLocalError("observation_invalid", "검색 rollout rollback 전이에 조치 근거가 없습니다.");
  }
  return activation;
}
