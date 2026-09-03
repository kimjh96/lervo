import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV13CheckpointContractPath,
  managedCanaryV14CheckpointContractPath,
  reviewedManagedCanaryV14CheckpointContractDigest,
} from "../../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { createExactManagedCanaryV5Authorization } from "../../natural-language-evaluation/linked-evidence-managed-canary-v5-execution.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

describe("managed linked-evidence canary v14 checkpoint", () => {
  it("binds exact execution while preserving the v13 population and gates", async () => {
    const [v13, v14] = await Promise.all([
      loadManagedCanaryCheckpointContract(repositoryRoot, managedCanaryV13CheckpointContractPath),
      loadManagedCanaryCheckpointContract(repositoryRoot, managedCanaryV14CheckpointContractPath),
    ]);
    const schedule = createManagedCanaryCheckpointSchedule(
      v14.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(v14.contractDigest).toBe(reviewedManagedCanaryV14CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(v14.contract.sourcePopulation).toEqual(v13.contract.sourcePopulation);
    expect(v14.contract.acceptance).toEqual(v13.contract.acceptance);
    expect(v14.contract.runtime.documentRoleContract).toEqual(
      v13.contract.runtime.documentRoleContract,
    );
    expect(v14.contract.runtime.executionContract).toEqual({
      authorizationBinding: "exact_prepared_manifest_digest",
      attemptPersistence: "before_provider_call",
      terminalObservationPersistence: "after_provider_terminal",
      sourceBuildRevalidation: "before_every_task",
      technicalFailureDisposition: "persist_bounded_failure_and_stop_without_retry",
      maximumConcurrentCalls: 1,
    });
    expect(v14.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v13-typed-context-20260829",
      preparedManifestDigest:
        "sha256:37383ba8a8eff8fd327627e392336371fbe2cedffb5a7665c401aa2e9083b3d7",
      providerCalls: 0,
      executionAuthorized: false,
    });
    expect(v14.contract.providers).toMatchObject({
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
    });
    expect(v14.contract.credentials.userApiKeysRequired).toBe(false);
  });

  it("creates only the reviewed sequential native-session authority", () => {
    const authorization = createExactManagedCanaryV5Authorization({
      checkpointId: "linked-evidence-managed-canary-v14-typed-execution-20260829",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      authorizedAt: "2026-08-29T14:50:00.000Z",
    });

    expect(authorization).toMatchObject({
      providers: { codex: 8, claude: 8 },
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
      userApiKeysRequired: false,
      nativeSignedInSessionsRequired: true,
      retriesAuthorized: false,
      repairsAuthorized: false,
      replacementsAuthorized: false,
      writesAuthorized: false,
      productionActivationAuthorized: false,
    });
  });
});
