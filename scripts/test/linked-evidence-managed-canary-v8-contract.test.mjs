import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV8CheckpointContractPath,
  reviewedManagedCanaryV8CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v8 checkpoint", () => {
  it("binds the read-only machine role and v7 terminal evidence", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV8CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );
    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV8CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(loaded.contract.task.roleId).toBe("canary-researcher");
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v7-native-session-20260829",
      terminallyStoppedDuringAdapterStart: true,
      conservativeAttemptedTaskCalls: 1,
      providerClientCreated: false,
      providerUsageObserved: false,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
    expect(loaded.contract.providers.maximumSelectionCalls).toBe(0);
  });
});
