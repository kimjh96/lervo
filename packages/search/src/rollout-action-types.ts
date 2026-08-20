import type { SearchEngineActivationPolicy } from "./engine-activation-types.js";
import type { SearchRolloutReviewPolicy } from "./rollout-policy-types.js";

export const SEARCH_ROLLOUT_ACTION_POLICY_PATTERN = /^srapol_[a-f0-9]{24}$/;
export const SEARCH_ROLLOUT_ACKNOWLEDGEMENT_PATTERN = /^srack_[a-f0-9]{24}$/;

export const searchRolloutActionKinds = ["acknowledge_keep", "execute_rollback"] as const;
export type SearchRolloutActionKind = (typeof searchRolloutActionKinds)[number];

export interface SearchRolloutActionPolicy {
  schemaVersion: 1;
  actionPolicyId: string;
  projectId: string;
  rolloutPolicyId: string;
  action: SearchRolloutActionKind;
  allowedOperatorIds: string[];
  engineActivationPolicyId: string | null;
  authoredBy: string;
  createdAt: string;
}

export interface SearchRolloutKeepAcknowledgement {
  schemaVersion: 1;
  acknowledgementId: string;
  projectId: string;
  action: "acknowledge_keep";
  actionPolicyId: string;
  rolloutPolicyId: string;
  rolloutReviewId: string;
  selectionTransitionId: string;
  qualitySnapshotId: string;
  qualityInputDigest: string;
  operatorId: string;
  acknowledgedAt: string;
  recordState: "acknowledgement_recorded";
  effect: {
    selectionChange: "not_applied";
    rollback: "not_executed";
    approval: "not_granted";
  };
}

export interface SearchRolloutActionPolicySources {
  rolloutPolicy: SearchRolloutReviewPolicy;
  engineActivationPolicy?: SearchEngineActivationPolicy;
}
