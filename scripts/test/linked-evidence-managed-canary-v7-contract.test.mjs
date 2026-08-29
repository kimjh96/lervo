import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV7CheckpointContractPath,
  reviewedManagedCanaryV7CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v7 checkpoint", () => {
  it("binds the machine-output role and v6 terminal evidence", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV7CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
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
