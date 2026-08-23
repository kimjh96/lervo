import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createSearchAttempt } from "@lervo/search";
import { LocalSearchObservationStore, runLocalOperationalSearch } from "@lervo/search-local";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupSearchComparisonRepositories,
  command,
  repository,
} from "./search-evaluation-comparison-fixture.js";
import { prepareSelectedSearchCandidate } from "./search-selected-candidate-fixture.js";

afterEach(async () => {
  vi.useRealTimers();
  await cleanupSearchComparisonRepositories();
});

describe("search rollout review command", () => {
  it("shows an empty implicit baseline before any rollout review exists", async () => {
    const root = await repository();
    const status = await command(root, ["search", "rollout", "status", "--json"]);

    expect(status.code, status.error).toBe(0);
    expect(JSON.parse(status.output)).toMatchObject({
      currentSelection: { selectionState: "implicit_baseline", selectionTransitionId: null },
      reviewCount: 0,
      reviews: [],
      nextCursor: null,
      reviewDecisionSelection: "not_performed",
    });
  });

  it("pages advisory reviews and detects later quality input without changing selection", async () => {
    const { root, project, activation, policy, registry } =
      await prepareSelectedSearchCandidate("researcher.rollout");
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
    expect(originalBytes).not.toContain("zephyrcontext");
    expect(originalBytes).not.toContain("docs/search-context.md");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:04:00.000Z"));
    const second = await command(root, [
      "search", "rollout", "review", activation.activationId,
      "--decision", "more-assessments", "--reviewer", "reviewer_second", "--json",
    ]);
    vi.setSystemTime(new Date("2026-08-20T10:05:00.000Z"));
    const firstPage = await command(root, ["search", "rollout", "status", "--limit", "1", "--json"]);
    vi.useRealTimers();
    expect(second.code, second.error).toBe(0);
    expect(firstPage.code, firstPage.error).toBe(0);
    const secondReviewId = (JSON.parse(second.output) as { rolloutReviewId: string }).rolloutReviewId;
    const firstStatus = JSON.parse(firstPage.output) as {
      currentSelection: { selectionState: string; selectionTransitionId: string };
      reviewCount: number;
      reviews: Array<{
        review: { rolloutReviewId: string; decision: string };
        qualityInputState: string;
        selectionRelation: string;
      }>;
      nextCursor: string;
      reviewDecisionSelection: string;
      effect: { selectionChange: string };
    };
    expect(firstStatus).toMatchObject({
      currentSelection: { selectionState: "candidate", selectionTransitionId: activation.activationId },
      reviewCount: 2,
      reviews: [{
        review: { rolloutReviewId: secondReviewId, decision: "more_assessments_required" },
        qualityInputState: "unchanged",
        selectionRelation: "current_selection",
      }],
      nextCursor: secondReviewId,
      reviewDecisionSelection: "not_performed",
      effect: { selectionChange: "not_applied" },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:05:00.000Z"));
    const nextPage = await command(root, [
      "search", "rollout", "status", "--limit", "1", "--cursor", firstStatus.nextCursor, "--json",
    ]);
    vi.useRealTimers();
    expect(nextPage.code, nextPage.error).toBe(0);
    expect(JSON.parse(nextPage.output)).toMatchObject({
      reviews: [{ review: { rolloutReviewId: review.rolloutReviewId } }],
      nextCursor: null,
    });

    const operational = await runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "zephyrcontext",
      limit: 5,
    });
    const laterAttempt = createSearchAttempt({
      projectId: project.projectId,
      observedAt: new Date("2026-08-20T10:06:00.000Z"),
      nonce: "d".repeat(32),
      response: operational.response,
      selectionTransitionId: operational.selectionTransitionId,
    });
    await (await LocalSearchObservationStore.open(root)).recordAttempt(laterAttempt);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:07:00.000Z"));
    const changed = await command(root, ["search", "rollout", "status", "--json"]);
    vi.useRealTimers();
    expect(changed.code, changed.error).toBe(0);
    const changedStatus = JSON.parse(changed.output) as {
      reviews: Array<{
        qualityInputState: string;
        currentQualitySnapshot: { totalAttempts: number; assessedAttempts: number };
      }>;
      reviewDecisionSelection: string;
    };
    expect(changedStatus.reviews).toHaveLength(2);
    expect(changedStatus.reviews.every((item) => item.qualityInputState === "changed")).toBe(true);
    expect(changedStatus.reviews[0]!.currentQualitySnapshot).toMatchObject({
      totalAttempts: 2,
      assessedAttempts: 1,
    });
    expect(changedStatus.reviewDecisionSelection).toBe("not_performed");

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:08:00.000Z"));
    const afterRollback = await command(root, ["search", "rollout", "status", "--json"]);
    vi.useRealTimers();
    expect(afterRollback.code, afterRollback.error).toBe(0);
    const rollbackStatus = JSON.parse(afterRollback.output) as {
      currentSelection: { selectionState: string };
      reviews: Array<{
        selectionRelation: string;
        review: { rolloutReviewId: string; effect: { rollback: string } };
      }>;
      effect: { rollback: string };
    };
    expect(rollbackStatus.currentSelection.selectionState).toBe("recorded_baseline");
    expect(rollbackStatus.reviews.every((item) => item.selectionRelation === "historical_selection")).toBe(true);
    expect(rollbackStatus.reviews.find((item) => item.review.rolloutReviewId === review.rolloutReviewId))
      .toMatchObject({ review: { effect: { rollback: "not_executed" } } });
    expect(rollbackStatus.effect.rollback).toBe("not_executed");
  });
});
