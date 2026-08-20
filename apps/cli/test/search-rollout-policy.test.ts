import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { createSearchRolloutReviewPolicy } from "@lervo/search";
import { recordSearchRolloutReviewPolicy } from "@lervo/search-local";
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

describe("search rollout policy commands", () => {
  it("creates a bounded immutable policy file for a registered candidate", async () => {
    const root = await repository();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T09:50:00.000Z"));
    const created = await command(root, [
      "search", "rollout", "policy", "create",
      "--reviewer", "reviewer_rollout", "--author", "reviewer_rollout",
      "--candidate", "bm25f-v1",
      "--keep-min-assessments", "3", "--keep-max-failures", "0",
      "--rollback-min-assessments", "3", "--rollback-min-failures", "1",
      "--json",
    ]);
    vi.useRealTimers();

    expect(created.code, created.error).toBe(0);
    const policy = JSON.parse(created.output) as { policyId: string };
    const directory = resolve(root, ".lervo/search-rollout-policies");
    expect(await readdir(directory)).toEqual([`${policy.policyId}.yaml`]);
    const path = resolve(directory, `${policy.policyId}.yaml`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toContain("minimumAssessedAttempts: 3");
  });

  it("rejects an ineligible decision, accepts a bound decision, and only reports policy checks", async () => {
    const { root, project, activation } = await prepareSelectedSearchCandidate("researcher.rollout-policy");
    const restrictive = createSearchRolloutReviewPolicy({
      projectId: project.projectId,
      allowedReviewerIds: ["reviewer_rollout"],
      allowedCandidateIds: ["fixture-v1"],
      keepMinimumAssessedAttempts: 2,
      keepMaximumFailedAttempts: 0,
      rollbackMinimumAssessedAttempts: 2,
      rollbackMinimumFailedAttempts: 1,
      authoredBy: "reviewer_rollout",
      createdAt: new Date("2026-08-20T09:50:00.000Z"),
    });
    const permissive = createSearchRolloutReviewPolicy({
      projectId: project.projectId,
      allowedReviewerIds: ["reviewer_rollout"],
      allowedCandidateIds: ["fixture-v1"],
      keepMinimumAssessedAttempts: 1,
      keepMaximumFailedAttempts: 0,
      rollbackMinimumAssessedAttempts: 1,
      rollbackMinimumFailedAttempts: 1,
      authoredBy: "reviewer_rollout",
      createdAt: new Date("2026-08-20T09:51:00.000Z"),
    });
    await recordSearchRolloutReviewPolicy(root, restrictive);
    await recordSearchRolloutReviewPolicy(root, permissive);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:03:00.000Z"));
    const rejected = await command(root, [
      "search", "rollout", "review", activation.activationId,
      "--decision", "keep", "--reviewer", "reviewer_rollout",
      "--policy", restrictive.policyId, "--json",
    ]);
    const accepted = await command(root, [
      "search", "rollout", "review", activation.activationId,
      "--decision", "keep", "--reviewer", "reviewer_rollout",
      "--policy", permissive.policyId, "--json",
    ]);
    vi.useRealTimers();

    expect(rejected.code).toBe(1);
    expect(rejected.error).toContain("insufficient_assessed_attempts");
    expect(accepted.code, accepted.error).toBe(0);
    const review = JSON.parse(accepted.output) as {
      schemaVersion: number;
      rolloutReviewId: string;
      rolloutPolicyId: string;
      effect: { selectionChange: string };
    };
    expect(review).toMatchObject({
      schemaVersion: 2,
      rolloutPolicyId: permissive.policyId,
      effect: { selectionChange: "not_applied" },
    });
    expect(await readdir(resolve(root, ".lervo/state/search/rollout-reviews")))
      .toEqual([`${review.rolloutReviewId}.json`]);

    const checked = await command(root, [
      "search", "rollout", "policy", "check", review.rolloutReviewId,
      "--policy", permissive.policyId, "--json",
    ]);
    const mismatched = await command(root, [
      "search", "rollout", "policy", "check", review.rolloutReviewId,
      "--policy", restrictive.policyId, "--json",
    ]);
    expect(checked.code, checked.error).toBe(0);
    expect(JSON.parse(checked.output)).toMatchObject({
      policyBindingState: "bound",
      reviewDecisionEligibility: "eligible",
      decisionSelection: "not_performed",
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    expect(mismatched.code, mismatched.error).toBe(0);
    expect(JSON.parse(mismatched.output)).toMatchObject({
      policyBindingState: "different_policy",
      reviewDecisionEligibility: "ineligible",
      failureReasons: expect.arrayContaining(["policy_mismatch"]),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:04:00.000Z"));
    const status = await command(root, ["search", "rollout", "status", "--json"]);
    vi.useRealTimers();
    expect(status.code, status.error).toBe(0);
    expect(JSON.parse(status.output)).toMatchObject({
      reviews: [{
        review: {
          schemaVersion: 2,
          rolloutPolicyId: permissive.policyId,
          thresholdPolicyState: "bound",
        },
        qualityInputState: "unchanged",
      }],
      reviewDecisionSelection: "not_performed",
    });
  });
});
