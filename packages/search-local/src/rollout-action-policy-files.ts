import type { LervoProjectPaths } from "@lervo/project";
import {
  assertSearchRolloutActionPolicy,
  SEARCH_ROLLOUT_ACTION_POLICY_PATTERN,
  type SearchRolloutActionPolicy,
} from "@lervo/search";

import {
  loadLocalPolicyFile,
  loadLocalPolicyFiles,
  recordLocalPolicyFile,
  type LocalPolicyFileContract,
} from "./policy-file-store.js";

const contract: LocalPolicyFileContract<SearchRolloutActionPolicy> = {
  label: "검색 rollout 조치 정책",
  directory: (paths: LervoProjectPaths) => paths.searchRolloutActionPolicies,
  idPattern: SEARCH_ROLLOUT_ACTION_POLICY_PATTERN,
  id: (policy) => policy.actionPolicyId,
  assertValue: assertSearchRolloutActionPolicy,
  maximumFiles: 32,
  errors: {
    invalid: "rollout_action_policy_invalid",
    notFound: "rollout_action_policy_not_found",
    readFailed: "rollout_action_policy_read_failed",
    writeFailed: "rollout_action_policy_write_failed",
  },
};

export async function loadSearchRolloutActionPolicies(repositoryRoot: string) {
  return loadLocalPolicyFiles({ repositoryRoot, contract });
}

export async function loadSearchRolloutActionPolicy(repositoryRoot: string, actionPolicyId: string) {
  return loadLocalPolicyFile({ repositoryRoot, policyId: actionPolicyId, contract });
}

export async function recordSearchRolloutActionPolicy(
  repositoryRoot: string,
  policy: SearchRolloutActionPolicy,
): Promise<void> {
  await recordLocalPolicyFile({ repositoryRoot, value: policy, contract });
}
