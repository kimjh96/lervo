import { assertSearchEngineActivationPolicy } from "./engine-activation-policy.js";
import { searchRolloutActionEligibilityFailureReasons } from "./rollout-action-eligibility.js";
import { verifySearchRolloutActionPolicySources } from "./rollout-action-policy.js";
import {
  searchRolloutActionKinds,
  type SearchRolloutActionKind,
  type SearchRolloutActionPolicy,
  type SearchRolloutActionPolicySources,
} from "./rollout-action-types.js";
import {
  searchRolloutActionPreflightFailureReasons,
  type SearchRolloutActionPreflight,
} from "./rollout-action-preflight-types.js";
import { assertSearchRolloutQualitySnapshot } from "./rollout-quality-snapshot.js";
import { assertSearchRolloutReview } from "./rollout-review.js";
import type { SearchRolloutQualitySnapshot, SearchRolloutReview } from "./rollout-review-types.js";
import { SearchError } from "./types.js";
import { SOURCE_ID_PATTERN } from "./validation.js";

export function createSearchRolloutActionPreflight(input: {
  actionPolicy: SearchRolloutActionPolicy;
  rolloutPolicy: SearchRolloutActionPolicySources["rolloutPolicy"];
  engineActivationPolicy?: SearchRolloutActionPolicySources["engineActivationPolicy"];
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
  currentSelectionTransitionId: string | null;
  requestedAction: SearchRolloutActionKind;
  operatorId: string;
  checkedAt: Date;
}): SearchRolloutActionPreflight {
  assertSearchRolloutReview(input.review);
  assertSearchRolloutQualitySnapshot(input.currentQualitySnapshot);
  if (input.engineActivationPolicy !== undefined) {
    assertSearchEngineActivationPolicy(input.engineActivationPolicy);
  }
  verifySearchRolloutActionPolicySources(input.actionPolicy, {
    rolloutPolicy: input.rolloutPolicy,
    ...(input.engineActivationPolicy === undefined
      ? {}
      : { engineActivationPolicy: input.engineActivationPolicy }),
  });
  if (!searchRolloutActionKinds.includes(input.requestedAction) || !SOURCE_ID_PATTERN.test(input.operatorId) ||
    !Number.isFinite(input.checkedAt.getTime()) || input.review.projectId !== input.actionPolicy.projectId ||
    input.currentQualitySnapshot.observedThrough !== input.checkedAt.toISOString()) {
    throw new SearchError("invalid_rollout_action_preflight", "The search rollout action preflight input is invalid.");
  }
  const requiredDecision = input.requestedAction === "acknowledge_keep"
    ? "keep_candidate" as const
    : "rollback_recommended" as const;
  const reasons = new Set(searchRolloutActionEligibilityFailureReasons({ ...input }));
  if (input.requestedAction === "execute_rollback" && input.actionPolicy.action === "execute_rollback" &&
    !input.engineActivationPolicy?.allowedOperatorIds.includes(input.operatorId)) {
    reasons.add("engine_operator_not_allowed");
  }
  const qualityInputState = input.currentQualitySnapshot.inputDigest === input.review.qualitySnapshot.inputDigest
    ? "unchanged" as const
    : "changed" as const;
  const failureReasons = searchRolloutActionPreflightFailureReasons.filter((reason) => reasons.has(reason));
  return {
    schemaVersion: 1,
    projectId: input.actionPolicy.projectId,
    checkedAt: input.checkedAt.toISOString(),
    rolloutReviewId: input.review.rolloutReviewId,
    actionPolicyId: input.actionPolicy.actionPolicyId,
    rolloutPolicyId: input.rolloutPolicy.policyId,
    engineActivationPolicyId: input.actionPolicy.engineActivationPolicyId,
    operatorId: input.operatorId,
    requestedAction: input.requestedAction,
    policyAction: input.actionPolicy.action,
    reviewDecision: input.review.decision,
    requiredDecision,
    reviewSelectionTransitionId: input.review.target.selectionTransitionId,
    currentSelectionTransitionId: input.currentSelectionTransitionId,
    qualityInputState,
    eligibility: failureReasons.length === 0 ? "eligible" : "ineligible",
    failureReasons,
    actionSelection: "not_performed",
    effect: {
      acknowledgement: "not_recorded",
      selectionChange: "not_applied",
      rollback: "not_executed",
      approval: "not_granted",
    },
  };
}
