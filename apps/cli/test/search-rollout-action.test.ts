import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createSearchAssessment,
  createSearchAttempt,
  createSearchRolloutReviewPolicy,
  contentId,
} from "@lervo/search";
import {
  LocalSearchObservationStore,
  recordSearchRolloutReviewPolicy,
  runLocalOperationalSearch,
} from "@lervo/search-local";
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

describe("search rollout action commands", () => {
  it("acknowledges an unchanged keep review and executes only a fresh rollback review", async () => {
    const { root, project, activation, policy: enginePolicy, registry } =
      await prepareSelectedSearchCandidate("researcher.rollout-action");
    const rolloutPolicy = createSearchRolloutReviewPolicy({
      projectId: project.projectId,
      allowedReviewerIds: ["reviewer_rollout"],
      allowedCandidateIds: ["fixture-v1"],
      keepMinimumAssessedAttempts: 1,
      keepMaximumFailedAttempts: 0,
      rollbackMinimumAssessedAttempts: 2,
      rollbackMinimumFailedAttempts: 1,
      authoredBy: "reviewer_rollout",
      createdAt: new Date("2026-08-20T09:50:00.000Z"),
    });
    await recordSearchRolloutReviewPolicy(root, rolloutPolicy);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:03:00.000Z"));
    const keepReviewResult = await command(root, [
      "search", "rollout", "review", activation.activationId,
      "--decision", "keep", "--reviewer", "reviewer_rollout",
      "--policy", rolloutPolicy.policyId, "--json",
    ]);
    vi.setSystemTime(new Date("2026-08-20T10:03:30.000Z"));
    const keepPolicyResult = await command(root, [
      "search", "rollout", "action", "policy", "create",
      "--review-policy", rolloutPolicy.policyId, "--action", "keep",
      "--operator", "operator_search", "--author", "operator_search", "--json",
    ]);
    const rollbackPolicyResult = await command(root, [
      "search", "rollout", "action", "policy", "create",
      "--review-policy", rolloutPolicy.policyId, "--action", "rollback",
      "--engine-policy", enginePolicy.policyId,
      "--operator", "operator_search", "--author", "operator_search", "--json",
    ]);
    vi.useRealTimers();
    expect(keepReviewResult.code, keepReviewResult.error).toBe(0);
    expect(keepPolicyResult.code, keepPolicyResult.error).toBe(0);
    expect(rollbackPolicyResult.code, rollbackPolicyResult.error).toBe(0);
    const keepReview = JSON.parse(keepReviewResult.output) as { rolloutReviewId: string };
    const keepPolicy = JSON.parse(keepPolicyResult.output) as { actionPolicyId: string };
    const rollbackPolicy = JSON.parse(rollbackPolicyResult.output) as { actionPolicyId: string };

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:04:00.000Z"));
    const unauthorized = await command(root, [
      "search", "rollout", "action", "apply", keepReview.rolloutReviewId,
      "--action", "keep", "--policy", keepPolicy.actionPolicyId,
      "--operator", "operator_other", "--json",
    ]);
    const acknowledged = await command(root, [
      "search", "rollout", "action", "apply", keepReview.rolloutReviewId,
      "--action", "keep", "--policy", keepPolicy.actionPolicyId,
      "--operator", "operator_search", "--json",
    ]);
    vi.useRealTimers();
    expect(unauthorized.code).toBe(1);
    expect(unauthorized.error).toContain("rollout_action_not_eligible");
    expect(acknowledged.code, acknowledged.error).toBe(0);
    expect(JSON.parse(acknowledged.output)).toMatchObject({
      action: "acknowledge_keep",
      rolloutReviewId: keepReview.rolloutReviewId,
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections"))).toEqual(["baseline.json"]);
    expect(await readdir(resolve(root, ".lervo/state/search/rollout-acknowledgements"))).toHaveLength(1);

    const operational = await runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "검색 맥락",
      limit: 5,
    });
    const laterAttempt = createSearchAttempt({
      projectId: project.projectId,
      observedAt: new Date("2026-08-20T10:05:00.000Z"),
      nonce: "e".repeat(32),
      response: operational.response,
      selectionTransitionId: operational.selectionTransitionId,
    });
    const failed = createSearchAssessment({
      attempt: laterAttempt,
      assessedAt: new Date("2026-08-20T10:06:00.000Z"),
      assessor: "human",
      outcome: "failed",
      failureReason: "results_not_relevant",
    });
    const store = await LocalSearchObservationStore.open(root);
    await store.recordAttempt(laterAttempt);
    await store.recordAssessment(failed);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:07:00.000Z"));
    const staleKeep = await command(root, [
      "search", "rollout", "action", "apply", keepReview.rolloutReviewId,
      "--action", "keep", "--policy", keepPolicy.actionPolicyId,
      "--operator", "operator_search", "--json",
    ]);
    vi.setSystemTime(new Date("2026-08-20T10:08:00.000Z"));
    const rollbackReviewResult = await command(root, [
      "search", "rollout", "review", activation.activationId,
      "--decision", "rollback", "--reviewer", "reviewer_rollout",
      "--policy", rolloutPolicy.policyId, "--json",
    ]);
    vi.setSystemTime(new Date("2026-08-20T10:09:00.000Z"));
    const rolledBack = await command(root, [
      "search", "rollout", "action", "apply",
      (JSON.parse(rollbackReviewResult.output) as { rolloutReviewId: string }).rolloutReviewId,
      "--action", "rollback", "--policy", rollbackPolicy.actionPolicyId,
      "--operator", "operator_search", "--json",
    ]);
    vi.useRealTimers();

    expect(staleKeep.code).toBe(1);
    expect(staleKeep.error).toContain("rollout_action_not_eligible");
    expect(rollbackReviewResult.code, rollbackReviewResult.error).toBe(0);
    expect(rolledBack.code, rolledBack.error).toBe(0);
    const rollback = JSON.parse(rolledBack.output) as {
      schemaVersion: number;
      activationId: string;
      selected: { mode: string };
      rolloutAction: { rolloutReviewId: string; actionPolicyId: string; qualityInputDigest: string };
    };
    expect(rollback).toMatchObject({
      schemaVersion: 3,
      action: "rollback",
      selected: { mode: "baseline" },
      rolloutAction: {
        actionPolicyId: rollbackPolicy.actionPolicyId,
        rolloutReviewId: (JSON.parse(rollbackReviewResult.output) as { rolloutReviewId: string }).rolloutReviewId,
      },
    });
    expect(rollback.rolloutAction.qualityInputDigest).toMatch(/^sha256:/);
    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections")))
      .toEqual(["baseline.json", `${activation.activationId}.json`]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:10:00.000Z"));
    const repeated = await command(root, [
      "search", "rollout", "action", "apply", rollback.rolloutAction.rolloutReviewId,
      "--action", "rollback", "--policy", rollbackPolicy.actionPolicyId,
      "--operator", "operator_search", "--json",
    ]);
    vi.useRealTimers();
    expect(repeated.code).toBe(1);
    expect(repeated.error).toContain("rollout_action_not_eligible");

    const rollbackPath = resolve(
      root,
      ".lervo/state/search/engine-selections",
      `${activation.activationId}.json`,
    );
    const tampered = JSON.parse(await readFile(rollbackPath, "utf8")) as Record<string, unknown> & {
      rolloutAction: { qualityInputDigest: string };
    };
    tampered.rolloutAction.qualityInputDigest = `sha256:${"f".repeat(64)}`;
    const { schemaVersion: _schema, activationId: _id, ...core } = tampered;
    tampered.activationId = contentId("seact", core);
    await writeFile(rollbackPath, `${JSON.stringify(tampered)}\n`, "utf8");
    const unavailable = await command(root, ["search", "engine", "status", "--json"]);
    expect(unavailable.code, unavailable.error).toBe(1);
    expect(JSON.parse(unavailable.output)).toMatchObject({
      resolverState: "unavailable",
      failureCode: "engine_selection_unavailable",
    });
  });
});
