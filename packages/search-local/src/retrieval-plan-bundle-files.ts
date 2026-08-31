import {
  assertSearchRetrievalPlanActivationBundle,
  type SearchRetrievalPlanActivationBundle,
} from "@lervo/search";

import {
  loadLocalPolicyFile,
  loadLocalPolicyFiles,
  recordLocalPolicyFile,
  type LocalPolicyFileContract,
} from "./policy-file-store.js";

const bundleContract: LocalPolicyFileContract<SearchRetrievalPlanActivationBundle> = {
  label: "search retrieval-plan activation bundle",
  directory: (paths) => paths.searchRetrievalPlanBundles,
  idPattern: /^srpbundle_[a-f0-9]{24}$/,
  id: (bundle) => bundle.bundleId,
  assertValue: assertSearchRetrievalPlanActivationBundle,
  maximumFiles: 16,
  errors: {
    invalid: "retrieval_plan_bundle_invalid",
    notFound: "retrieval_plan_bundle_not_found",
    readFailed: "retrieval_plan_bundle_read_failed",
    writeFailed: "retrieval_plan_bundle_write_failed",
  },
};

export async function loadSearchRetrievalPlanActivationBundles(
  repositoryRoot: string,
): Promise<SearchRetrievalPlanActivationBundle[]> {
  return loadLocalPolicyFiles({ repositoryRoot, contract: bundleContract });
}

export async function loadSearchRetrievalPlanActivationBundle(
  repositoryRoot: string,
  bundleId: string,
): Promise<SearchRetrievalPlanActivationBundle> {
  return loadLocalPolicyFile({ repositoryRoot, policyId: bundleId, contract: bundleContract });
}

export async function recordSearchRetrievalPlanActivationBundle(
  repositoryRoot: string,
  bundle: SearchRetrievalPlanActivationBundle,
): Promise<void> {
  await recordLocalPolicyFile({ repositoryRoot, value: bundle, contract: bundleContract });
}
