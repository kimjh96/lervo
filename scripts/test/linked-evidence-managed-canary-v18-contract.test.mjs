import { describe, expect, it } from "vitest";

import {
  loadManagedCanaryCheckpointContract,
  managedCanaryV18CheckpointContractPath,
  reviewedManagedCanaryV18CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { createExactManagedCanaryV5Authorization } from "../natural-language-evaluation/linked-evidence-managed-canary-v5-execution.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v18 checkpoint", () => {
  it("binds the immutable v17 stop and complete evidence capacity", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV18CheckpointContractPath,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV18CheckpointContractDigest);
    expect(loaded.contract.technicalPredecessor).toMatchObject({
      preparedManifestDigest:
        "sha256:70f21a85823e0fc5a7b078860155859f5c1ce25e9d2fb2f9c0c0387dd0a50074",
      observationSetDigest:
        "sha256:0a7d03e5b8064057ce9a293b04ce03a297ac53a3efc4e9c09edc74b75d5a626e",
      completedRuns: 10,
      failedRuns: 1,
      providerCalls: 10,
      selectionCalls: 0,
      acceptedAccuracySamples: 10,
      failedRunTaskProviderCalls: 0,
      failedRunAdapterCreations: 0,
      immutable: true,
      retry: false,
    });
    expect(loaded.contract.runtime.observationCapacity).toEqual({
      sourceRecordBaseline: 74,
      maximumRecords: 128,
      historicalRecordsDeleted: false,
      sourceRelevantEventBaseline: 4105,
      maximumRelevantEvents: 8192,
      maximumTotalEventBytes: 16777216,
      historicalEventsDeleted: false,
      eventProjectionTruncated: false,
      overflowFailureCode: "knowledge_evidence_source_invalid",
    });
  });

  it("authorizes only a fresh exact 8+8 sequential population", () => {
    expect(
      createExactManagedCanaryV5Authorization({
        checkpointId: "linked-evidence-managed-canary-v18-event-capacity-safe-20260830",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        authorizedAt: "2026-08-29T17:47:00.000Z",
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
