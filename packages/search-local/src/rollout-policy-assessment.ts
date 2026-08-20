import {
  evaluateSearchRolloutReviewPolicy,
  type SearchRolloutPolicyAssessment,
} from "@lervo/search";

import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import { loadStoredSearchRolloutReview } from "./rollout-review-store.js";
import { SearchLocalError } from "./types.js";

export async function assessLocalSearchRolloutReviewPolicy(input: {
  repositoryRoot: string;
  projectId: string;
  policyId: string;
  rolloutReviewId: string;
}): Promise<SearchRolloutPolicyAssessment> {
  const [policy, review] = await Promise.all([
    loadSearchRolloutReviewPolicy(input.repositoryRoot, input.policyId),
    loadStoredSearchRolloutReview(input.repositoryRoot, input.rolloutReviewId),
  ]);
  if (policy.projectId !== input.projectId || review.projectId !== input.projectId) {
    throw new SearchLocalError("rollout_policy_invalid", "검색 rollout 정책·검토의 project 좌표가 다릅니다.");
  }
  return evaluateSearchRolloutReviewPolicy(policy, review);
}
