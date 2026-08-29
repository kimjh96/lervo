import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV9CheckpointContractPath,
  reviewedManagedCanaryV9CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v9 checkpoint", () => {
  it("binds the shared execution clock and v8 terminal evidence", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV9CheckpointContractPath,
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
    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV9CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(loaded.contract.runtime.nativeTaskUsesRuntimeClock).toBe(true);
    expect(loaded.contract.task.roleId).toBe("canary-researcher");
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v8-native-session-20260829",
      terminallyStoppedDuringContextPreparation: true,
      providerClientCreated: true,
      modelTurnStarted: false,
      providerUsageObserved: false,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
  });
});
