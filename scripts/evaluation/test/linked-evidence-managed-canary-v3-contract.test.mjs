import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV3CheckpointContractPath,
  reviewedManagedCanaryV3CheckpointContractDigest,
} from "../../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { valueDigest } from "../../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed linked-evidence canary v3 checkpoint", () => {
  it("binds reviewed provider-specific V18 selections to a zero-selection-call schedule", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV3CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV3CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.every((item) => item.selectionTransport === undefined)).toBe(true);
    expect(new Set(schedule.map((item) => item.sourceSampleId)).size).toBe(8);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(loaded.contract.sourcePopulation).toMatchObject({
      sourceProviderShadowPilotId:
        "linked-evidence-provider-shadow-v18-relational-coverage-confirmation-20260829",
      sourceProviderShadowManifestDigest:
        "sha256:a00d3772f9b40ae23a7a30787eb0c2b149d19387a986307f1b91aa5655a73ff3",
      sourceProviderShadowReviewFileDigest:
        "sha256:24ccaf50b3523d6c3c5f0df19b10930e2383a1784010122659522cc504d9552c",
    });
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
