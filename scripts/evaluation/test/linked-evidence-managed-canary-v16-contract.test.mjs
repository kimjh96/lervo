import { describe, expect, it } from "vitest";

import {
  loadManagedCanaryCheckpointContract,
  managedCanaryV16CheckpointContractPath,
  reviewedManagedCanaryV16CheckpointContractDigest,
} from "../../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { createExactManagedCanaryV5Authorization } from "../../natural-language-evaluation/linked-evidence-managed-canary-v5-execution.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

describe("managed linked-evidence canary v16 checkpoint", () => {
  it("binds the canonical E4 projection and immutable v15 failure", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV16CheckpointContractPath,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV16CheckpointContractDigest);
    expect(loaded.contract.technicalPredecessor).toMatchObject({
      preparedManifestDigest:
        "sha256:4b51c58f6a6c3443e1abe2a90d989ceab77314af575126effd95e9652872fccd",
      observationSetDigest:
        "sha256:f4353b25add8b47f4d309642b7c50832cdbf64e540ebc2be7e23d87c67dcf237",
      completedRuns: 0,
      failedRuns: 1,
      providerCalls: 1,
      selectionCalls: 0,
      acceptedAccuracySamples: 0,
      immutable: true,
      retry: false,
    });
    expect(loaded.contract.runtime.measurementProjection).toEqual({
      source: "canonical_e4_context_evidence",
      fields: ["referencedDocuments", "referencedDocumentIds"],
      documentIdsSorted: true,
      documentIdsDeduplicated: true,
      providerOutputParsing: false,
      groundTruthFiltering: false,
    });
    expect(loaded.contract.acceptance).toMatchObject({
      requiredSourceRecall: 1,
      minimumPerRunReferencePrecision: 0.5,
      minimumMeanReferencePrecisionPerProvider: 0.65,
    });
  });

  it("authorizes only the new exact 8+8 sequential population", () => {
    expect(
      createExactManagedCanaryV5Authorization({
        checkpointId: "linked-evidence-managed-canary-v16-claim-eligibility-20260830",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        authorizedAt: "2026-08-29T16:37:00.000Z",
      }),
    ).toMatchObject({
      providers: { codex: 8, claude: 8 },
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
      userApiKeysRequired: false,
      retriesAuthorized: false,
      replacementsAuthorized: false,
      productionActivationAuthorized: false,
    });
  });
});
