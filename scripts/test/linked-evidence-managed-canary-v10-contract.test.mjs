import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV10CheckpointContractPath,
  reviewedManagedCanaryV10CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v10 checkpoint", () => {
  it("binds the past manifest clock and v9 terminal evidence", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV10CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );
    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV10CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(loaded.contract.runtime.manifestBoundClockEarlierThanRuntime).toBe(true);
    expect(loaded.contract.task.roleId).toBe("canary-researcher");
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v9-native-session-20260829",
      terminallyStoppedBeforeAdapterCreation: true,
      providerClientCreated: false,
      modelTurnStarted: false,
      providerUsageObserved: false,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
  });
});
