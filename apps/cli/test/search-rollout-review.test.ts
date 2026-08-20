import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupSearchComparisonRepositories,
  command,
} from "./search-evaluation-comparison-fixture.js";
import { prepareSelectedSearchCandidate } from "./search-selected-candidate-fixture.js";

afterEach(async () => {
  vi.useRealTimers();
  await cleanupSearchComparisonRepositories();
});

describe("search rollout review command", () => {
  it("records an idempotent advisory review without changing selection", async () => {
    const { root, activation, policy } = await prepareSelectedSearchCandidate("researcher.rollout");
    const args = [
      "search", "rollout", "review", activation.activationId,
      "--decision", "keep", "--reviewer", "reviewer_rollout", "--json",
    ];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:03:00.000Z"));
    const created = await command(root, args);
    const repeated = await command(root, args);
    vi.useRealTimers();

    expect(created.code, created.error).toBe(0);
    expect(repeated.code, repeated.error).toBe(0);
    const review = JSON.parse(created.output) as {
      rolloutReviewId: string;
      qualitySnapshot: { totalAttempts: number; assessedAttempts: number };
      effect: { selectionChange: string; rollback: string; approval: string };
    };
    expect(review).toMatchObject({
      qualitySnapshot: { totalAttempts: 1, assessedAttempts: 1 },
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    expect((JSON.parse(repeated.output) as { rolloutReviewId: string }).rolloutReviewId)
      .toBe(review.rolloutReviewId);
    expect(await readdir(resolve(root, ".lervo/state/search/rollout-reviews")))
      .toEqual([`${review.rolloutReviewId}.json`]);
    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections"))).toEqual(["baseline.json"]);
    const path = resolve(root, ".lervo/state/search/rollout-reviews", `${review.rolloutReviewId}.json`);
    const originalBytes = await readFile(path, "utf8");
    expect(originalBytes).not.toContain("검색 맥락");
    expect(originalBytes).not.toContain("docs/search-context.md");

    const rolledBack = await command(root, [
      "search", "engine", "rollback", "--policy", policy.policyId,
      "--operator", "operator_search", "--json",
    ]);
    expect(rolledBack.code, rolledBack.error).toBe(0);
    expect(await readFile(path, "utf8")).toBe(originalBytes);
    const historical = await command(root, [
      "search", "rollout", "review", activation.activationId,
      "--decision", "rollback", "--reviewer", "reviewer_rollout", "--json",
    ]);
    expect(historical.code).toBe(1);
    expect(historical.error).toContain("rollout_review_not_eligible");
  });
});
