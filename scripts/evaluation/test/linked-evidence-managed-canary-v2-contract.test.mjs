import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV2CheckpointContractPath,
  reviewedManagedCanaryV2CheckpointContractDigest,
} from "../../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { valueDigest } from "../../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed linked-evidence canary v2 checkpoint", () => {
  it("binds paired no-tool transports to the exact 16-run schedule", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV2CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV2CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(new Set(schedule.map((item) => item.sourceSampleId)).size).toBe(8);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "codex")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "gpt-5.6-sol",
          selectionTransport: {
            kind: "responses_api_no_tools",
            endpoint: "https://api.openai.com/v1/responses",
            tools: [],
            toolChoice: "none",
            store: false,
            maximumOutputTokens: 512,
          },
        }),
      ]),
    );
    expect(schedule.filter((item) => item.provider === "claude")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "opus",
          selectionTransport: { kind: "claude_sdk_no_tools", tools: [] },
        }),
      ]),
    );
    expect(loaded.contract.terminalPredecessor).toMatchObject({
      checkpointId: "linked-evidence-managed-canary-v1-prepared-20260829",
      terminallyStopped: true,
      resume: false,
      retry: false,
      repair: false,
      replacementRuns: false,
    });
    expect(loaded.contract.authorization).toMatchObject({
      providerCallsAuthorized: false,
      managedContextEffectsAuthorized: false,
      productionActivationAuthorized: false,
    });
    expect(loaded.contract.providers.maximumProviderCalls).toBe(32);
    expect(loaded.contract.retention.maximumPilots).toBe(2);
  });

  it("rejects changed v2 contract bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-canary-v2-contract-"));
    roots.push(root);
    const target = resolve(root, managedCanaryV2CheckpointContractPath);
    const source = await readFile(
      resolve(repositoryRoot, managedCanaryV2CheckpointContractPath),
      "utf8",
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      source.replace('"maximumOutputTokens": 512', '"maximumOutputTokens": 513'),
    );
    await expect(
      loadManagedCanaryCheckpointContract(root, managedCanaryV2CheckpointContractPath),
    ).rejects.toThrow(/differs from the reviewed bytes/u);
  });

  it("keeps a prepared v2 manifest owner-only and non-executable", async () => {
    const preparedPath = resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-managed-canary-pilots",
      "linked-evidence-managed-canary-v2-prepared-20260829",
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
      status: "prepared_for_review",
      providerCalls: 0,
      executionAuthorized: false,
      managedContextEffectsAuthorized: false,
      taskRunCount: 16,
      providerCallCeiling: 32,
    });
    expect(source).not.toMatch(/"query"\s*:/u);
    expect(source).not.toContain(repositoryRoot);
    expect(source).not.toMatch(/"path"\s*:/u);
    if (process.platform !== "win32") expect((await stat(preparedPath)).mode & 0o777).toBe(0o600);
    expect(valueDigest(prepared.manifest)).toBe(prepared.manifestDigest);
  });
});
