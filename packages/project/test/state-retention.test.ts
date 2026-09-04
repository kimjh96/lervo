import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyStatePrune,
  planStatePrune,
  publicStatePrunePlan,
  type StateRetentionEvidence,
  type StateRetentionPolicy,
} from "../src/index.js";

const roots: string[] = [];
const evidence = (overrides: Partial<StateRetentionEvidence> = {}): StateRetentionEvidence => ({
  completedNormalizationCandidateIds: new Set(),
  completedCanonicalizationCandidateIds: new Set(),
  completedDeliberationIds: new Set(),
  activeDeliberationIds: new Set(),
  ...overrides,
});
const immediatePolicy: StateRetentionPolicy = {
  rebuildable_cache: { maxAgeMs: 1, maxCount: 100, maxBytes: 1_000_000 },
  completed_workspace: { maxAgeMs: 1, maxCount: 100, maxBytes: 1_000_000 },
  bounded_observation: { maxAgeMs: 1, maxCount: 100, maxBytes: 1_000_000 },
};

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-state-retention-"));
  roots.push(root);
  const paths = [
    ".lervo/data/cas/durable",
    ".lervo/state/knowledge/current/inventory.json",
    ".lervo/state/knowledge/normalization-shards/cache.json",
    ".lervo/state/knowledge/normalization-candidates/aa/knorm_aaaaaaaaaaaaaaaaaaaaaaaa.json",
    ".lervo/state/knowledge/canonicalization-candidates/aa/kcanon_aaaaaaaaaaaaaaaaaaaaaaaa.json",
    ".lervo/state/deliberations/dlb_completed123/work.json",
    ".lervo/state/deliberations/dlb_active123/checkpoint.json",
    ".lervo/state/search/performance-reports/report.json",
  ];
  for (const path of paths) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), path);
    await utimes(resolve(root, path), new Date(0), new Date(0));
  }
  return root;
}

describe("typed derived-state retention", () => {
  it("selects only completed or rebuildable state and hides path/content coordinates", async () => {
    const root = await fixture();
    const plan = await planStatePrune({
      repositoryRoot: root,
      evidence: evidence({
        completedCanonicalizationCandidateIds: new Set(["kcanon_aaaaaaaaaaaaaaaaaaaaaaaa"]),
        completedDeliberationIds: new Set(["dlb_completed123"]),
        activeDeliberationIds: new Set(["dlb_active123"]),
      }),
      policy: immediatePolicy,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(plan.operations.map((item) => item.retentionClass).toSorted()).toEqual([
      "bounded_observation",
      "completed_workspace",
      "rebuildable_cache",
      "rebuildable_cache",
    ]);
    expect(plan.summaries.find((item) => item.retentionClass === "pending_review")?.fileCount).toBe(
      1,
    );
    expect(
      plan.summaries.find((item) => item.retentionClass === "recovery_required")?.fileCount,
    ).toBe(1);
    expect(JSON.stringify(publicStatePrunePlan(plan))).not.toContain("normalization-shards");
    expect(JSON.stringify(publicStatePrunePlan(plan))).not.toContain("contentDigest");
  });

  it("applies an exact plan, preserves durable data, and leaves protected state", async () => {
    const root = await fixture();
    const completionEvidence = evidence({
      completedCanonicalizationCandidateIds: new Set(["kcanon_aaaaaaaaaaaaaaaaaaaaaaaa"]),
      completedDeliberationIds: new Set(["dlb_completed123"]),
      activeDeliberationIds: new Set(["dlb_active123"]),
    });
    const plan = await planStatePrune({
      repositoryRoot: root,
      evidence: completionEvidence,
      policy: immediatePolicy,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const recorded: string[] = [];
    const receipt = await applyStatePrune({
      plan,
      approval: plan.planId,
      evidence: completionEvidence,
      policy: immediatePolicy,
      recordEvent: (value) => {
        recorded.push(value.planId);
      },
    });

    expect(receipt.removedFiles).toBe(4);
    expect(recorded).toEqual([plan.planId]);
    expect(await readFile(resolve(root, ".lervo/data/cas/durable"), "utf8")).toContain("durable");
    expect(
      await readFile(resolve(root, ".lervo/state/knowledge/current/inventory.json"), "utf8"),
    ).toContain("inventory");
    expect(
      await readFile(
        resolve(
          root,
          ".lervo/state/knowledge/normalization-candidates/aa/knorm_aaaaaaaaaaaaaaaaaaaaaaaa.json",
        ),
        "utf8",
      ),
    ).toContain("normalization-candidates");
  });

  it("rejects stale plans and rolls back when durable event recording fails", async () => {
    const root = await fixture();
    const completionEvidence = evidence({
      completedCanonicalizationCandidateIds: new Set(["kcanon_aaaaaaaaaaaaaaaaaaaaaaaa"]),
      completedDeliberationIds: new Set(["dlb_completed123"]),
      activeDeliberationIds: new Set(["dlb_active123"]),
    });
    const plan = await planStatePrune({
      repositoryRoot: root,
      evidence: completionEvidence,
      policy: immediatePolicy,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await writeFile(
      resolve(root, ".lervo/state/knowledge/normalization-shards/cache.json"),
      "changed",
    );
    await expect(
      applyStatePrune({
        plan,
        approval: plan.planId,
        evidence: completionEvidence,
        policy: immediatePolicy,
        recordEvent: () => undefined,
      }),
    ).rejects.toThrow("changed after planning");

    const current = await planStatePrune({
      repositoryRoot: root,
      evidence: completionEvidence,
      policy: immediatePolicy,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await expect(
      applyStatePrune({
        plan: current,
        approval: current.planId,
        evidence: completionEvidence,
        policy: immediatePolicy,
        recordEvent: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toThrow("event unavailable");
    expect(
      await readFile(
        resolve(root, ".lervo/state/knowledge/normalization-shards/cache.json"),
        "utf8",
      ),
    ).toBe("changed");
  });

  it("does not invalidate a prune approval when an always-protected current projection advances", async () => {
    const root = await fixture();
    const completionEvidence = evidence({
      completedCanonicalizationCandidateIds: new Set(["kcanon_aaaaaaaaaaaaaaaaaaaaaaaa"]),
      completedDeliberationIds: new Set(["dlb_completed123"]),
      activeDeliberationIds: new Set(["dlb_active123"]),
    });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const planned = await planStatePrune({
      repositoryRoot: root,
      evidence: completionEvidence,
      policy: immediatePolicy,
      now,
    });
    await writeFile(
      resolve(root, ".lervo/state/knowledge/current/inventory.json"),
      '{"generation":2}',
    );
    const current = await planStatePrune({
      repositoryRoot: root,
      evidence: completionEvidence,
      policy: immediatePolicy,
      now,
    });
    expect(current.planId).toBe(planned.planId);
  });
});
