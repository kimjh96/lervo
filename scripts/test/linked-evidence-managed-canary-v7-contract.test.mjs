import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV7CheckpointContractPath,
  reviewedManagedCanaryV7CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v7 checkpoint", () => {
  it("binds the machine-output role and v6 terminal evidence", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV7CheckpointContractPath,
    );
    const source = JSON.parse(
      await readFile(
        resolve(
          repositoryRoot,
          ".lervo/state/search/linked-evidence-provider-shadow-pilots",
          loaded.contract.sourcePopulation.sourceProviderShadowPilotId,
          "controller/prepared.json",
        ),
        "utf8",
      ),
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      source.manifest.schedule,
    );
    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV7CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(loaded.contract.task.roleId).toBe("developer");
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v6-native-session-20260829",
      terminallyStoppedAfterPreProviderValidation: true,
      conservativeAttemptedTaskCalls: 1,
      providerUsageObserved: false,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
    expect(loaded.contract.providers.maximumSelectionCalls).toBe(0);
  });
});
