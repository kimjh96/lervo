import { describe, expect, it } from "vitest";

import {
  loadManagedCanaryCheckpointContract,
  managedCanaryV17CheckpointContractPath,
  reviewedManagedCanaryV17CheckpointContractDigest,
} from "../../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { createExactManagedCanaryV5Authorization } from "../../natural-language-evaluation/linked-evidence-managed-canary-v5-execution.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

describe("managed linked-evidence canary v17 checkpoint", () => {
  it("binds the immutable v16 capacity stop and expanded bounded store", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV17CheckpointContractPath,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV17CheckpointContractDigest);
    expect(loaded.contract.technicalPredecessor).toMatchObject({
      preparedManifestDigest:
        "sha256:c36e9650eb2adf3d00715090643866977b6274a28a34890498c36d1766fa9b84",
      observationSetDigest:
        "sha256:d79d2b2f4aee533c05a190b45035a65376671f277b09b17c71073a5edd57dc49",
      completedRuns: 11,
      failedRuns: 1,
      providerCalls: 12,
      selectionCalls: 0,
      acceptedAccuracySamples: 11,
      sourceRecordBaseline: 64,
      sourceRecordLimit: 64,
      immutable: true,
      retry: false,
    });
    expect(loaded.contract.runtime.observationCapacity).toEqual({
      sourceRecordBaseline: 64,
      maximumRecords: 128,
      historicalRecordsDeleted: false,
      overflowFailureCode: "observation_limit_exceeded",
    });
    expect(loaded.contract.acceptance).toMatchObject({
      requiredSourceRecall: 1,
      minimumPerRunReferencePrecision: 0.5,
      minimumMeanReferencePrecisionPerProvider: 0.65,
    });
  });

  it("authorizes only a fresh exact 8+8 sequential population", () => {
    expect(
      createExactManagedCanaryV5Authorization({
        checkpointId: "linked-evidence-managed-canary-v17-capacity-safe-20260830",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        authorizedAt: "2026-08-29T17:17:00.000Z",
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
