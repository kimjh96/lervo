import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV4CheckpointContractPath,
  reviewedManagedCanaryV4CheckpointContractDigest,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { valueDigest } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed linked-evidence canary v4 checkpoint", () => {
  it("binds a deterministic all-candidate policy to 16 native-session task calls", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV4CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV4CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.every((item) => item.selectionTransport === undefined)).toBe(true);
    expect(new Set(schedule.map((item) => item.sourceSampleId)).size).toBe(8);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(loaded.contract.selection).toMatchObject({
      kind: "deterministic_all_current_linked_candidates_v1",
      policyId: "managed-linked-evidence-all-candidates-v1",
      rule: "select_all_current_managed_linked_candidates_in_projection_order",
      minimumSelectionsPerRun: 1,
      maximumSelectionCallsPerRun: 0,
    });
    expect(loaded.contract.credentials.userApiKeysRequired).toBe(false);
    expect(loaded.contract.providers).toMatchObject({
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
    });
    expect(loaded.contract.rejectedPredecessor).toMatchObject({
      preparedManifestDigest:
        "sha256:b93952d09b44e77223cd5b217480e0af1dda748ae548d0dc65ca1e3717dbf0cc",
      providerCalls: 0,
      codexProjectedSelectionCount: 0,
      claudeProjectedSelectionCount: 1,
      resume: false,
    });
  });

  it("rejects changed v4 contract bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-canary-v4-contract-"));
    roots.push(root);
    const target = resolve(root, managedCanaryV4CheckpointContractPath);
    const source = await readFile(
      resolve(repositoryRoot, managedCanaryV4CheckpointContractPath),
      "utf8",
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      source.replace('"minimumSelectionsPerRun": 1', '"minimumSelectionsPerRun": 0'),
    );
    await expect(
      loadManagedCanaryCheckpointContract(root, managedCanaryV4CheckpointContractPath),
    ).rejects.toThrow(/differs from the reviewed bytes/u);
  });

  it("keeps every prepared selection exact, nonempty, owner-only, key-free, and non-executable", async () => {
    const preparedPath = resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-managed-canary-pilots",
      "linked-evidence-managed-canary-v4-deterministic-20260829",
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
