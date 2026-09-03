import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  reviewedManagedCanaryCheckpointContractDigest,
} from "../../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { valueDigest } from "../../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed linked-evidence canary v1 checkpoint", () => {
  it("binds an exact default-off 16-run paired schedule and 32-call ceiling", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(repositoryRoot);
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryCheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(new Set(schedule.map((item) => item.sourceSampleId)).size).toBe(8);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(
      [...new Set(schedule.map((item) => item.sourceSampleId))].every((sourceSampleId) => {
        const providers = schedule
          .filter((item) => item.sourceSampleId === sourceSampleId)
          .map((item) => item.provider)
          .sort();
        return JSON.stringify(providers) === JSON.stringify(["claude", "codex"]);
      }),
    ).toBe(true);
    expect(loaded.contract.providers.maximumProviderCalls).toBe(32);
    expect(loaded.contract.authorization).toMatchObject({
      providerCallsAuthorized: false,
      managedContextEffectsAuthorized: false,
      productionActivationAuthorized: false,
    });
  });

  it("rejects changed contract bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-canary-contract-"));
    roots.push(root);
    const target = resolve(root, "contract.json");
    const source = await readFile(
      resolve(repositoryRoot, "benchmarks/search/linked-evidence-managed-canary-v1.json"),
      "utf8",
    );
    await writeFile(
      target,
      source.replace('"maximumProviderCalls": 32', '"maximumProviderCalls": 33'),
    );
    await expect(loadManagedCanaryCheckpointContract(root, "contract.json")).rejects.toThrow(
      /differs from the reviewed bytes/u,
    );
  });

  it("keeps a prepared manifest owner-only, privacy-bounded, and non-executable", async () => {
    const preparedPath = resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-managed-canary-pilots",
      "linked-evidence-managed-canary-v1-prepared-20260829",
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
