import type { LervoProjectPaths } from "@lervo/project";
import {
  assertSearchRolloutReviewPolicy,
  SEARCH_ROLLOUT_POLICY_PATTERN,
  type SearchRolloutReviewPolicy,
} from "@lervo/search";

import {
  loadLocalPolicyFile,
  loadLocalPolicyFiles,
  recordLocalPolicyFile,
  type LocalPolicyFileContract,
} from "./policy-file-store.js";

const contract: LocalPolicyFileContract<SearchRolloutReviewPolicy> = {
  label: "검색 rollout 검토 정책",
  directory: (paths: LervoProjectPaths) => paths.searchRolloutPolicies,
  idPattern: SEARCH_ROLLOUT_POLICY_PATTERN,
  id: (policy) => policy.policyId,
  assertValue: assertSearchRolloutReviewPolicy,
  maximumFiles: 32,
  errors: {
    invalid: "rollout_policy_invalid",
    notFound: "rollout_policy_not_found",
    readFailed: "rollout_policy_read_failed",
    writeFailed: "rollout_policy_write_failed",
  },
};

export async function loadSearchRolloutReviewPolicies(repositoryRoot: string) {
  return loadLocalPolicyFiles({ repositoryRoot, contract });
}

export async function loadSearchRolloutReviewPolicy(repositoryRoot: string, policyId: string) {
  return loadLocalPolicyFile({ repositoryRoot, policyId, contract });
}

export async function recordSearchRolloutReviewPolicy(
  repositoryRoot: string,
  policy: SearchRolloutReviewPolicy,
): Promise<void> {
  await recordLocalPolicyFile({ repositoryRoot, value: policy, contract });
}
