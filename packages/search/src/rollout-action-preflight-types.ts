import type { SearchRolloutActionKind } from "./rollout-action-types.js";
import type { SearchRolloutReviewDecision } from "./rollout-review-types.js";

export const searchRolloutActionPreflightFailureReasons = [
  "requested_action_mismatch",
  "action_policy_not_active",
  "review_not_active",
  "review_policy_not_bound",
  "review_policy_mismatch",
  "review_decision_mismatch",
  "review_policy_not_eligible",
  "operator_not_allowed",
  "engine_operator_not_allowed",
  "selection_not_current",
  "quality_input_changed",
] as const;

export type SearchRolloutActionPreflightFailureReason =
  (typeof searchRolloutActionPreflightFailureReasons)[number];

export interface SearchRolloutActionPreflight {
  schemaVersion: 1;
  projectId: string;
  checkedAt: string;
  rolloutReviewId: string;
  actionPolicyId: string;
  rolloutPolicyId: string;
  engineActivationPolicyId: string | null;
  operatorId: string;
  requestedAction: SearchRolloutActionKind;
  policyAction: SearchRolloutActionKind;
  reviewDecision: SearchRolloutReviewDecision;
  requiredDecision: "keep_candidate" | "rollback_recommended";
  reviewSelectionTransitionId: string;
  currentSelectionTransitionId: string | null;
  qualityInputState: "unchanged" | "changed";
  eligibility: "eligible" | "ineligible";
  failureReasons: SearchRolloutActionPreflightFailureReason[];
  actionSelection: "not_performed";
  effect: {
    acknowledgement: "not_recorded";
    selectionChange: "not_applied";
    rollback: "not_executed";
    approval: "not_granted";
  };
}
