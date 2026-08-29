import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV3CheckpointContractPath,
  reviewedManagedCanaryV3CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { valueDigest } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;
const roots = [];
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed linked-evidence canary v3 checkpoint", () => {
  it("binds reviewed provider-specific V18 selections to a zero-selection-call schedule", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV3CheckpointContractPath,
    );
    const pilotRoot = resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-provider-shadow-pilots",
      loaded.contract.sourcePopulation.sourceProviderShadowPilotId,
    );
    const v18 = JSON.parse(await readFile(resolve(pilotRoot, "controller/prepared.json"), "utf8"));
    const reviewBytes = await readFile(resolve(pilotRoot, "controller/review.json"));
    const review = JSON.parse(reviewBytes.toString("utf8"));
    const schedule = createManagedCanaryCheckpointSchedule(loaded.contract, v18.manifest.schedule);
    const observations = await Promise.all(
      (await readdir(resolve(pilotRoot, "observations")))
        .filter((item) => /^\d{2}-(?:codex|claude)\.json$/u.test(item))
        .map(async (item) =>
          JSON.parse(await readFile(resolve(pilotRoot, "observations", item), "utf8")),
        ),
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV3CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.every((item) => item.selectionTransport === undefined)).toBe(true);
    expect(new Set(schedule.map((item) => item.sourceSampleId)).size).toBe(8);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(
      schedule.every(
        (item) =>
          observations.filter(
            (observation) =>
              observation.sourceSampleId === item.sourceSampleId &&
              observation.provider === item.provider &&
              observation.terminalStatus === "completed" &&
              observation.failureCode === null,
          ).length === 1,
      ),
    ).toBe(true);
    expect(review).toMatchObject({ status: "passed", passed: true, observationCount: 32 });
    expect(sha256(reviewBytes)).toBe(
      loaded.contract.sourcePopulation.sourceProviderShadowReviewFileDigest,
    );
    expect(loaded.contract.credentials).toEqual({
      userApiKeysRequired: false,
      codex: "reuse_native_chatgpt_or_codex_session",
      claude: "reuse_native_claude_session",
      optionalByokSelectionTransportInPrimaryPath: false,
    });
    expect(loaded.contract.providers).toMatchObject({
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
    });
  });

  it("rejects changed v3 contract bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-canary-v3-contract-"));
    roots.push(root);
    const target = resolve(root, managedCanaryV3CheckpointContractPath);
    const source = await readFile(
      resolve(repositoryRoot, managedCanaryV3CheckpointContractPath),
      "utf8",
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      source.replace('"maximumProviderCalls": 16', '"maximumProviderCalls": 17'),
    );
    await expect(
      loadManagedCanaryCheckpointContract(root, managedCanaryV3CheckpointContractPath),
    ).rejects.toThrow(/differs from the reviewed bytes/u);
  });

  it("keeps a prepared v3 manifest owner-only, key-free, and non-executable", async () => {
    const preparedPath = resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-managed-canary-pilots",
      "linked-evidence-managed-canary-v3-native-session-20260829",
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
      selectionCallCeiling: 0,
      providerCallCeiling: 16,
    });
    expect(prepared.manifest.runs).toHaveLength(16);
    expect(
      prepared.manifest.runs.every(
        (run) =>
          run.selectionProviderVisibleSourceBytes === 0 &&
          run.selectionEvidence.kind === "reviewed_provider_shadow_v18_projection",
      ),
    ).toBe(true);
    expect(source).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|"apiKey"/u);
    expect(source).not.toMatch(/"query"\s*:/u);
    expect(source).not.toContain(repositoryRoot);
    expect(source).not.toMatch(/"path"\s*:/u);
    if (process.platform !== "win32") expect((await stat(preparedPath)).mode & 0o777).toBe(0o600);
    expect(valueDigest(prepared.manifest)).toBe(prepared.manifestDigest);
  });
});
