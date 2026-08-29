import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV12CheckpointContractPath,
  managedCanaryV13CheckpointContractPath,
  reviewedManagedCanaryV13CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v13 checkpoint", () => {
  it("binds the typed context boundary without changing the v12 population or gates", async () => {
    const [v12, v13] = await Promise.all([
      loadManagedCanaryCheckpointContract(repositoryRoot, managedCanaryV12CheckpointContractPath),
      loadManagedCanaryCheckpointContract(repositoryRoot, managedCanaryV13CheckpointContractPath),
    ]);
    const schedule = createManagedCanaryCheckpointSchedule(
      v13.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(v13.contractDigest).toBe(reviewedManagedCanaryV13CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(v13.contract.sourcePopulation.selectedCaseIds).toEqual(
      v12.contract.sourcePopulation.selectedCaseIds,
    );
    expect(v13.contract.sourcePopulation.selectedRepetitions).toEqual(
      v12.contract.sourcePopulation.selectedRepetitions,
    );
    expect(v13.contract.acceptance).toEqual(v12.contract.acceptance);
    expect(v13.contract.runtime.documentRoleContract).toMatchObject({
      taskEvidenceRole: "task_evidence",
      governanceContextRole: "governance_context",
      governanceEvidenceToken: null,
      receiptRoleMatchRequired: true,
    });
    expect(v13.contract.measurementPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v12-native-session-20260829",
      completedRuns: 16,
      technicalFailures: 0,
      promptOnlyConstraintRejected: true,
      rolledBack: true,
      activationBlocked: true,
    });
    expect(v13.contract.providers).toMatchObject({
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
    });
    expect(v13.contract.authorization).toMatchObject({
      providerCallsAuthorized: false,
      managedContextEffectsAuthorized: false,
      productionActivationAuthorized: false,
      operatorAuthority: "not_requested",
    });
  });

  it("exposes no live authorization or execution operation", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../run-linked-evidence-managed-canary-v13.mjs", import.meta.url)),
        "authorize",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Live authorization and execution are not available in v13.");
  });
});
