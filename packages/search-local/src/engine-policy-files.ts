import type { LervoProjectPaths } from "@lervo/project";
import {
  assertSearchEngineActivationPolicy,
  SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN,
  type SearchEngineActivationPolicy,
} from "@lervo/search";

import {
  loadLocalPolicyFile,
  loadLocalPolicyFiles,
  recordLocalPolicyFile,
  type LocalPolicyFileContract,
} from "./policy-file-store.js";

const contract: LocalPolicyFileContract<SearchEngineActivationPolicy> = {
  label: "search engine activation policy",
  directory: (paths: LervoProjectPaths) => paths.searchEnginePolicies,
  idPattern: SEARCH_ENGINE_ACTIVATION_POLICY_PATTERN,
  id: (policy) => policy.policyId,
  assertValue: assertSearchEngineActivationPolicy,
  maximumFiles: 32,
  errors: {
    invalid: "engine_policy_invalid",
    notFound: "engine_policy_not_found",
    readFailed: "engine_policy_read_failed",
    writeFailed: "engine_policy_write_failed",
  },
};

export async function loadSearchEngineActivationPolicies(repositoryRoot: string) {
  return loadLocalPolicyFiles({ repositoryRoot, contract });
}

export async function loadSearchEngineActivationPolicy(repositoryRoot: string, policyId: string) {
  return loadLocalPolicyFile({ repositoryRoot, policyId, contract });
}

export async function recordSearchEngineActivationPolicy(
  repositoryRoot: string,
  policy: SearchEngineActivationPolicy,
): Promise<void> {
  await recordLocalPolicyFile({ repositoryRoot, value: policy, contract });
}
