import type { SearchRolloutActionPreflightFailureReason } from "./rollout-action-preflight-types.js";
import { searchRolloutActionPreflightFailureReasons } from "./rollout-action-preflight-types.js";
import type { SearchRolloutActionKind, SearchRolloutActionPolicy } from "./rollout-action-types.js";
import { evaluateSearchRolloutReviewPolicy } from "./rollout-policy.js";
import type { SearchRolloutReviewPolicy } from "./rollout-policy-types.js";
import type { SearchRolloutQualitySnapshot, SearchRolloutReview } from "./rollout-review-types.js";

export function searchRolloutActionEligibilityFailureReasons(input: {
  actionPolicy: SearchRolloutActionPolicy;
  rolloutPolicy: SearchRolloutReviewPolicy;
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
  currentSelectionTransitionId: string | null;
  requestedAction: SearchRolloutActionKind;
  operatorId: string;
  checkedAt: Date;
}): SearchRolloutActionPreflightFailureReason[] {
  const requiredDecision =
    input.requestedAction === "acknowledge_keep" ? "keep_candidate" : "rollback_recommended";
  const policyAssessment = evaluateSearchRolloutReviewPolicy(input.rolloutPolicy, input.review);
  const reasons = new Set<SearchRolloutActionPreflightFailureReason>();
  if (input.actionPolicy.action !== input.requestedAction) reasons.add("requested_action_mismatch");
  if (Date.parse(input.actionPolicy.createdAt) > input.checkedAt.getTime())
    reasons.add("action_policy_not_active");
  if (Date.parse(input.review.reviewedAt) > input.checkedAt.getTime())
    reasons.add("review_not_active");
  if (input.review.schemaVersion === 1) reasons.add("review_policy_not_bound");
  else if (input.review.rolloutPolicyId !== input.rolloutPolicy.policyId)
    reasons.add("review_policy_mismatch");
  if (input.review.decision !== requiredDecision) reasons.add("review_decision_mismatch");
  if (policyAssessment.reviewDecisionEligibility !== "eligible")
    reasons.add("review_policy_not_eligible");
  if (!input.actionPolicy.allowedOperatorIds.includes(input.operatorId))
    reasons.add("operator_not_allowed");
  if (input.currentSelectionTransitionId !== input.review.target.selectionTransitionId) {
    reasons.add("selection_not_current");
  }
  if (input.currentQualitySnapshot.inputDigest !== input.review.qualitySnapshot.inputDigest) {
    reasons.add("quality_input_changed");
  }
  return searchRolloutActionPreflightFailureReasons.filter((reason) => reasons.has(reason));
}
