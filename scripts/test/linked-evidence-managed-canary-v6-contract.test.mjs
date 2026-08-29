import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV6CheckpointContractPath,
  reviewedManagedCanaryV6CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { valueDigest } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("managed linked-evidence canary v6 checkpoint", () => {
  it("binds the exact execution operation and native-session population", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV6CheckpointContractPath,
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
    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV6CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(schedule.every((item) => item.selectionTransport === undefined)).toBe(true);
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v5-native-session-20260829",
      preparedManifestDigest:
        "sha256:85a22b76aa5a07ab58e66eb58035cedbd64b83780b8c356b6cc835f1c90d8f02",
      providerCalls: 0,
      nonemptySelectionRuns: 16,
    });
    expect(loaded.contract.providers).toMatchObject({
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
  });

  it("keeps an optional prepared v6 manifest exact, owner-only, and non-executable", async () => {
    const preparedPath = resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-managed-canary-pilots",
      "linked-evidence-managed-canary-v6-native-session-20260829",
      "controller/prepared.json",
    );
    let source;
    try {
      source = await readFile(preparedPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    const prepared = JSON.parse(source);
    expect(prepared.manifest).toMatchObject({
      taskRunCount: 16,
      selectionCallCeiling: 0,
      providerCallCeiling: 16,
      providerCalls: 0,
      executionAuthorized: false,
    });
    expect(prepared.manifest.runs.every((run) => run.selectionEvidence.selected.length > 0)).toBe(
      true,
    );
    expect(source).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|"apiKey"/u);
    if (process.platform !== "win32") expect((await stat(preparedPath)).mode & 0o777).toBe(0o600);
    expect(valueDigest(prepared.manifest)).toBe(prepared.manifestDigest);
  });
});
