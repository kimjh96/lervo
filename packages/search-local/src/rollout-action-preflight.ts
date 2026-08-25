import {
  createSearchRolloutActionPreflight,
  type SearchCandidateEngineResolver,
  type SearchRolloutActionKind,
  type SearchRolloutActionPreflight,
} from "@lervo/search";

import { verifyLocalSearchCandidateRollbackReadiness } from "./engine-activation-runner.js";
import { loadSearchEngineActivationPolicy } from "./engine-policy-files.js";
import { loadSearchRolloutActionPolicy } from "./rollout-action-policy-files.js";
import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import { loadVerifiedLocalSearchRolloutReviewState } from "./rollout-review-state.js";

export async function checkLocalSearchRolloutAction(input: {
  repositoryRoot: string;
  projectId: string;
  rolloutReviewId: string;
  actionPolicyId: string;
  requestedAction: SearchRolloutActionKind;
  operatorId: string;
  checkedAt: Date;
  registry: SearchCandidateEngineResolver;
}): Promise<SearchRolloutActionPreflight> {
  const [actionPolicy, state] = await Promise.all([
    loadSearchRolloutActionPolicy(input.repositoryRoot, input.actionPolicyId),
    loadVerifiedLocalSearchRolloutReviewState({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      rolloutReviewId: input.rolloutReviewId,
      observedAt: input.checkedAt,
    }),
  ]);
  const [rolloutPolicy, engineActivationPolicy] = await Promise.all([
    loadSearchRolloutReviewPolicy(input.repositoryRoot, actionPolicy.rolloutPolicyId),
    actionPolicy.engineActivationPolicyId === null
      ? Promise.resolve(undefined)
      : loadSearchEngineActivationPolicy(
          input.repositoryRoot,
          actionPolicy.engineActivationPolicyId,
        ),
  ]);
  const result = createSearchRolloutActionPreflight({
    actionPolicy,
    rolloutPolicy,
    ...(engineActivationPolicy === undefined ? {} : { engineActivationPolicy }),
    ...state,
    requestedAction: input.requestedAction,
    operatorId: input.operatorId,
    checkedAt: input.checkedAt,
  });
  if (result.eligibility === "eligible" && input.requestedAction === "execute_rollback") {
    await verifyLocalSearchCandidateRollbackReadiness({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      policyId: actionPolicy.engineActivationPolicyId!,
      operatorId: input.operatorId,
      decidedAt: input.checkedAt,
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
  }
  return result;
}
