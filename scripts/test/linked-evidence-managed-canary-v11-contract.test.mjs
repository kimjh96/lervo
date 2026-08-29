import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV11CheckpointContractPath,
  reviewedManagedCanaryV11CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v11 checkpoint", () => {
  it("binds linked-selection forwarding and v10 terminal evidence", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV11CheckpointContractPath,
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
    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV11CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(loaded.contract.runtime.linkedEvidenceSelectionsForwardedThroughPrepareContext).toBe(
      true,
    );
    expect(loaded.contract.task.roleId).toBe("canary-researcher");
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v10-native-session-20260829",
      terminallyStoppedAfterModelTurn: true,
      providerClientCreated: true,
      modelTurnStarted: true,
      modelTurnCompleted: true,
      providerUsageObserved: true,
      completionEvidenceRejected: true,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
  });
});
