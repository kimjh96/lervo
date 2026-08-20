export const SEARCH_ROLLOUT_POLICY_PATTERN = /^srpol_[a-f0-9]{24}$/;

export interface SearchRolloutReviewPolicy {
  schemaVersion: 1;
  policyId: string;
  projectId: string;
  allowedReviewerIds: string[];
  allowedCandidateIds: string[];
  rules: {
    keepCandidate: {
      minimumAssessedAttempts: number;
      maximumFailedAttempts: number;
    };
    rollbackRecommended: {
      minimumAssessedAttempts: number;
      minimumFailedAttempts: number;
    };
    moreAssessmentsRequired: {
      allowed: true;
    };
  };
  authoredBy: string;
  createdAt: string;
}

export const searchRolloutPolicyFailureReasons = [
  "policy_not_bound",
  "policy_mismatch",
  "policy_created_after_review",
  "reviewer_not_allowed",
  "candidate_not_allowed",
  "insufficient_assessed_attempts",
  "too_many_failed_attempts",
  "too_few_failed_attempts",
] as const;

export type SearchRolloutPolicyFailureReason = (typeof searchRolloutPolicyFailureReasons)[number];

export interface SearchRolloutPolicyAssessment {
  schemaVersion: 1;
  projectId: string;
  policyId: string;
  rolloutReviewId: string;
  policyBindingState: "bound" | "legacy_unbound" | "different_policy";
  ruleOutcomes: {
    keepCandidate: "eligible" | "ineligible";
    rollbackRecommended: "eligible" | "ineligible";
    moreAssessmentsRequired: "eligible" | "ineligible";
  };
  reviewDecisionEligibility: "eligible" | "ineligible";
  failureReasons: SearchRolloutPolicyFailureReason[];
  decisionSelection: "not_performed";
  effect: {
    selectionChange: "not_applied";
    rollback: "not_executed";
    approval: "not_granted";
  };
}
