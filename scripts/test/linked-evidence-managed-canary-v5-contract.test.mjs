import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV5CheckpointContractPath,
  reviewedManagedCanaryV5CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { valueDigest } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { createExactManagedCanaryV5Authorization } from "../natural-language-evaluation/linked-evidence-managed-canary-v5-execution.mjs";
import { extractManagedCanaryV5References } from "../natural-language-evaluation/linked-evidence-managed-canary-native-task.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed linked-evidence canary v5 checkpoint", () => {
  it("binds the verified deterministic runtime to 16 native-session task calls", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV5CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV5CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.every((item) => item.selectionTransport === undefined)).toBe(true);
    expect(new Set(schedule.map((item) => item.sourceSampleId)).size).toBe(8);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(loaded.contract.selection).toMatchObject({
      kind: "deterministic_all_current_linked_candidates_v1",
      policyId: "managed-linked-evidence-all-candidates-v1",
      policyDigest: "sha256:8063ff4d0c1825b3abe35f81a53f245b988b8c6ea1e0cdacf2a690bbea76cb18",
      minimumSelectionsPerRun: 1,
      maximumSelectionCallsPerRun: 0,
    });
    expect(loaded.contract.runtime).toMatchObject({
      selectionAdapterCreationsPerRun: 0,
      canaryRecordSchemaVersion: 2,
      legacyRecordSchemaVersionPreserved: 1,
      deterministicSelectionAdapterReceipt: null,
      deterministicSelectionUsage: null,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
    expect(loaded.contract.providers).toMatchObject({
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
    });
    expect(loaded.contract.preparationPredecessor).toMatchObject({
      preparedManifestDigest:
        "sha256:c3a5983fc19b0543e5a951a7dca19d89a89c1300e6e146a81dd107441ebef8ba",
      providerCalls: 0,
      nonemptySelectionRuns: 16,
      runtimeImplementedAfterPreparation: true,
    });
  });

  it("rejects changed v5 contract bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-canary-v5-contract-"));
    roots.push(root);
    const target = resolve(root, managedCanaryV5CheckpointContractPath);
    const source = await readFile(
      resolve(repositoryRoot, managedCanaryV5CheckpointContractPath),
      "utf8",
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      source.replace(
        '"selectionAdapterCreationsPerRun": 0',
        '"selectionAdapterCreationsPerRun": 1',
      ),
    );
    await expect(
      loadManagedCanaryCheckpointContract(root, managedCanaryV5CheckpointContractPath),
    ).rejects.toThrow(/differs from the reviewed bytes/u);
  });

  it("binds execution authority to the reviewed manifest and extracts only current references", () => {
    const authorization = createExactManagedCanaryV5Authorization({
      checkpointId: "linked-evidence-managed-canary-v5-native-session-20260829",
      manifestDigest: "sha256:85a22b76aa5a07ab58e66eb58035cedbd64b83780b8c356b6cc835f1c90d8f02",
      authorizedAt: "2026-08-29T10:30:00.000Z",
    });
    expect(authorization).toMatchObject({
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      userApiKeysRequired: false,
      nativeSignedInSessionsRequired: true,
      retriesAuthorized: false,
    });
    const currentHash = `sha256:${"a".repeat(64)}`;
    const staleHash = `sha256:${"b".repeat(64)}`;
    expect(
      extractManagedCanaryV5References(
        [
          `<!-- lervo-e4:doc_current_01:${currentHash} -->`,
          `<!-- lervo-e4:doc_current_01:${currentHash} -->`,
          `<!-- lervo-e4:doc_stale_01:${staleHash} -->`,
        ].join("\n"),
        new Map([
          ["doc_current_01", currentHash],
          ["doc_stale_01", currentHash],
        ]),
      ),
    ).toEqual([{ documentId: "doc_current_01", contentHash: currentHash }]);
    expect(() =>
      createExactManagedCanaryV5Authorization({
        checkpointId: "linked-evidence-managed-canary-v5-native-session-20260829",
        manifestDigest: "sha256:not-a-digest",
        authorizedAt: "2026-08-29T10:30:00.000Z",
      }),
    ).toThrow(/unreviewed_manifest/u);
  });

  it("keeps every prepared selection exact, nonempty, owner-only, key-free, and non-executable", async () => {
    const preparedPath = resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-managed-canary-pilots",
      "linked-evidence-managed-canary-v5-native-session-20260829",
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
          run.candidateCount >= 1 &&
          run.candidateCount === run.selectionEvidence.projectedSelectionCount &&
          run.candidateCount === run.selectionEvidence.selected.length &&
          run.selectionProviderVisibleSourceBytes === 0 &&
          run.selectionEvidence.kind === "deterministic_all_current_linked_candidates_v1" &&
          valueDigest(run.selectionEvidence.selected) ===
            run.selectionEvidence.projectedSelectionDigest,
      ),
    ).toBe(true);
    expect(source).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|"apiKey"/u);
    expect(source).not.toMatch(/"selectionTransport"\s*:/u);
    expect(source).not.toMatch(/"query"\s*:/u);
    expect(source).not.toContain(repositoryRoot);
    expect(source).not.toMatch(/"path"\s*:/u);
    if (process.platform !== "win32") expect((await stat(preparedPath)).mode & 0o777).toBe(0o600);
    expect(valueDigest(prepared.manifest)).toBe(prepared.manifestDigest);
  });
});
