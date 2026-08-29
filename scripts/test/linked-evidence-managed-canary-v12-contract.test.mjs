import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV12CheckpointContractPath,
  reviewedManagedCanaryV12CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v12 checkpoint", () => {
  it("binds the provider-neutral E4 constraint and v11 terminal evidence", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV12CheckpointContractPath,
    );
    const source = JSON.parse(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(
          new URL(
            `../../.lervo/state/search/linked-evidence-provider-shadow-pilots/${loaded.contract.sourcePopulation.sourceProviderShadowPilotId}/controller/prepared.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      source.manifest.schedule,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV12CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(loaded.contract.runtime.providerNeutralReferenceInstructionDigest).toBe(
      "sha256:84e77840809a3a078066a8961e1d5a06e8620790e44f234abf5cee9f681a4a0f",
    );
    expect(loaded.contract.runtime.referenceObservationPolicy).toBe(
      "record_exact_current_tokens_from_raw_provider_output_without_ground_truth_filtering",
    );
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v11-native-session-20260829",
      completedRuns: 16,
      technicalFailures: 0,
      providerCalls: 16,
      selectionCalls: 0,
      activationBlocked: true,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
  });
});
