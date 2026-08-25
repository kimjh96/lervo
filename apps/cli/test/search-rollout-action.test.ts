import { readFile, readdir, rename, writeFile } from "node:fs/promises";
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
  repository,
} from "./search-evaluation-comparison-fixture.js";
import { prepareSelectedSearchCandidate } from "./search-selected-candidate-fixture.js";

afterEach(async () => {
  vi.useRealTimers();
  await cleanupSearchComparisonRepositories();
});

describe("search rollout action commands", () => {
  it("shows an empty read-only action page before a rollout action exists", async () => {
    const root = await repository();
    const status = await command(root, ["search", "rollout", "action", "status", "--json"]);

    expect(status.code, status.error).toBe(0);
    expect(JSON.parse(status.output)).toMatchObject({
      currentSelection: { selectionState: "implicit_baseline", selectionTransitionId: null },
      actionCount: 0,
      actions: [],
      nextCursor: null,
      actionSelection: "not_performed",
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
  });

  it("acknowledges an unchanged keep review and executes only a fresh rollback review", async () => {
    const {
      root,
      project,
      activation,
      policy: enginePolicy,
      registry,
    } = await prepareSelectedSearchCandidate("researcher.rollout-action");
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
      "search",
      "rollout",
      "review",
      activation.activationId,
      "--decision",
      "keep",
      "--reviewer",
      "reviewer_rollout",
      "--policy",
      rolloutPolicy.policyId,
      "--json",
    ]);
    vi.setSystemTime(new Date("2026-08-20T10:03:30.000Z"));
    const keepPolicyResult = await command(root, [
      "search",
      "rollout",
      "action",
      "policy",
      "create",
      "--review-policy",
      rolloutPolicy.policyId,
      "--action",
      "keep",
      "--operator",
      "operator_search",
      "--author",
      "operator_search",
      "--json",
    ]);
    const rollbackPolicyResult = await command(root, [
      "search",
      "rollout",
      "action",
      "policy",
      "create",
      "--review-policy",
      rolloutPolicy.policyId,
      "--action",
      "rollback",
      "--engine-policy",
      enginePolicy.policyId,
      "--operator",
      "operator_search",
      "--author",
      "operator_search",
      "--json",
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
    const searchStateBeforeCheck = await readdir(resolve(root, ".lervo/state/search"));
    const deniedCheck = await command(root, [
      "search",
      "rollout",
      "action",
      "check",
      keepReview.rolloutReviewId,
      "--action",
      "keep",
      "--policy",
      keepPolicy.actionPolicyId,
      "--operator",
      "operator_other",
      "--json",
    ]);
    const eligibleCheck = await command(root, [
      "search",
      "rollout",
      "action",
      "check",
      keepReview.rolloutReviewId,
      "--action",
      "keep",
      "--policy",
      keepPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    expect(deniedCheck.code, deniedCheck.error).toBe(0);
    expect(JSON.parse(deniedCheck.output)).toMatchObject({
      eligibility: "ineligible",
      failureReasons: ["operator_not_allowed"],
      actionSelection: "not_performed",
    });
    expect(eligibleCheck.code, eligibleCheck.error).toBe(0);
    expect(JSON.parse(eligibleCheck.output)).toMatchObject({
      eligibility: "eligible",
      failureReasons: [],
      effect: {
        acknowledgement: "not_recorded",
        selectionChange: "not_applied",
        rollback: "not_executed",
        approval: "not_granted",
      },
    });
    expect(await readdir(resolve(root, ".lervo/state/search"))).toEqual(searchStateBeforeCheck);
    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections"))).toEqual([
      "baseline.json",
    ]);
    const unauthorized = await command(root, [
      "search",
      "rollout",
      "action",
      "apply",
      keepReview.rolloutReviewId,
      "--action",
      "keep",
      "--policy",
      keepPolicy.actionPolicyId,
      "--operator",
      "operator_other",
      "--json",
    ]);
    const acknowledged = await command(root, [
      "search",
      "rollout",
      "action",
      "apply",
      keepReview.rolloutReviewId,
      "--action",
      "keep",
      "--policy",
      keepPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
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
    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections"))).toEqual([
      "baseline.json",
    ]);
    expect(
      await readdir(resolve(root, ".lervo/state/search/rollout-acknowledgements")),
    ).toHaveLength(1);

    const operational = await runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "zephyrcontext",
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
    const staleCheck = await command(root, [
      "search",
      "rollout",
      "action",
      "check",
      keepReview.rolloutReviewId,
      "--action",
      "keep",
      "--policy",
      keepPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    const staleKeep = await command(root, [
      "search",
      "rollout",
      "action",
      "apply",
      keepReview.rolloutReviewId,
      "--action",
      "keep",
      "--policy",
      keepPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    vi.setSystemTime(new Date("2026-08-20T10:08:00.000Z"));
    const rollbackReviewResult = await command(root, [
      "search",
      "rollout",
      "review",
      activation.activationId,
      "--decision",
      "rollback",
      "--reviewer",
      "reviewer_rollout",
      "--policy",
      rolloutPolicy.policyId,
      "--json",
    ]);
    vi.setSystemTime(new Date("2026-08-20T10:09:00.000Z"));
    const rollbackReviewId = (
      JSON.parse(rollbackReviewResult.output) as { rolloutReviewId: string }
    ).rolloutReviewId;
    const rollbackCheck = await command(root, [
      "search",
      "rollout",
      "action",
      "check",
      rollbackReviewId,
      "--action",
      "rollback",
      "--policy",
      rollbackPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections"))).toEqual([
      "baseline.json",
    ]);
    const rolledBack = await command(root, [
      "search",
      "rollout",
      "action",
      "apply",
      rollbackReviewId,
      "--action",
      "rollback",
      "--policy",
      rollbackPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    vi.useRealTimers();

    expect(staleCheck.code, staleCheck.error).toBe(0);
    expect(JSON.parse(staleCheck.output)).toMatchObject({
      eligibility: "ineligible",
      failureReasons: ["quality_input_changed"],
      qualityInputState: "changed",
    });
    expect(staleKeep.code).toBe(1);
    expect(staleKeep.error).toContain("rollout_action_not_eligible");
    expect(rollbackReviewResult.code, rollbackReviewResult.error).toBe(0);
    expect(rollbackCheck.code, rollbackCheck.error).toBe(0);
    expect(JSON.parse(rollbackCheck.output)).toMatchObject({
      eligibility: "eligible",
      failureReasons: [],
      requestedAction: "execute_rollback",
      engineActivationPolicyId: enginePolicy.policyId,
      effect: { acknowledgement: "not_recorded", rollback: "not_executed" },
    });
    expect(rolledBack.code, rolledBack.error).toBe(0);
    const rollback = JSON.parse(rolledBack.output) as {
      schemaVersion: number;
      activationId: string;
      selected: { mode: string };
      rolloutAction: {
        rolloutReviewId: string;
        actionPolicyId: string;
        qualityInputDigest: string;
      };
    };
    expect(rollback).toMatchObject({
      schemaVersion: 3,
      action: "rollback",
      selected: { mode: "baseline" },
      rolloutAction: {
        actionPolicyId: rollbackPolicy.actionPolicyId,
        rolloutReviewId: (JSON.parse(rollbackReviewResult.output) as { rolloutReviewId: string })
          .rolloutReviewId,
      },
    });
    expect(rollback.rolloutAction.qualityInputDigest).toMatch(/^sha256:/);
    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections"))).toEqual([
      "baseline.json",
      `${activation.activationId}.json`,
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:10:00.000Z"));
    const repeatedCheck = await command(root, [
      "search",
      "rollout",
      "action",
      "check",
      rollback.rolloutAction.rolloutReviewId,
      "--action",
      "rollback",
      "--policy",
      rollbackPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    const repeated = await command(root, [
      "search",
      "rollout",
      "action",
      "apply",
      rollback.rolloutAction.rolloutReviewId,
      "--action",
      "rollback",
      "--policy",
      rollbackPolicy.actionPolicyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    vi.useRealTimers();
    expect(repeatedCheck.code, repeatedCheck.error).toBe(0);
    expect(JSON.parse(repeatedCheck.output)).toMatchObject({
      eligibility: "ineligible",
      failureReasons: ["selection_not_current"],
    });
    expect(repeated.code).toBe(1);
    expect(repeated.error).toContain("rollout_action_not_eligible");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:11:00.000Z"));
    const firstPage = await command(root, [
      "search",
      "rollout",
      "action",
      "status",
      "--limit",
      "1",
      "--json",
    ]);
    vi.useRealTimers();
    expect(firstPage.code, firstPage.error).toBe(0);
    const firstStatus = JSON.parse(firstPage.output) as {
      actionCount: number;
      actions: Array<{
        actionId: string;
        action: string;
        reviewSelectionRelation: string;
        actionTransitionRelation: string;
      }>;
      nextCursor: string;
      actionSelection: string;
    };
    expect(firstStatus).toMatchObject({
      actionCount: 2,
      actions: [
        {
          actionId: rollback.activationId,
          action: "execute_rollback",
          reviewSelectionRelation: "historical_selection",
          actionTransitionRelation: "current_selection",
        },
      ],
      nextCursor: rollback.activationId,
      actionSelection: "not_performed",
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:11:00.000Z"));
    const nextPage = await command(root, [
      "search",
      "rollout",
      "action",
      "status",
      "--limit",
      "1",
      "--cursor",
      firstStatus.nextCursor,
      "--json",
    ]);
    vi.useRealTimers();
    expect(nextPage.code, nextPage.error).toBe(0);
    expect(JSON.parse(nextPage.output)).toMatchObject({
      actions: [
        {
          action: "acknowledge_keep",
          reviewSelectionRelation: "historical_selection",
          actionTransitionRelation: "not_applicable",
        },
      ],
      nextCursor: null,
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });

    const acknowledgementDirectory = resolve(root, ".lervo/state/search/rollout-acknowledgements");
    const acknowledgementName = (await readdir(acknowledgementDirectory))[0]!;
    const acknowledgementPath = resolve(acknowledgementDirectory, acknowledgementName);
    const forgedAcknowledgement = JSON.parse(await readFile(acknowledgementPath, "utf8")) as Record<
      string,
      unknown
    > & { acknowledgementId: string; qualityInputDigest: string };
    forgedAcknowledgement.qualityInputDigest = `sha256:${"f".repeat(64)}`;
    const {
      schemaVersion: _ackSchema,
      acknowledgementId: _ackId,
      ...ackCore
    } = forgedAcknowledgement;
    forgedAcknowledgement.acknowledgementId = contentId("srack", ackCore);
    const forgedAcknowledgementPath = resolve(
      acknowledgementDirectory,
      `${forgedAcknowledgement.acknowledgementId}.json`,
    );
    await rename(acknowledgementPath, forgedAcknowledgementPath);
    await writeFile(
      forgedAcknowledgementPath,
      `${JSON.stringify(forgedAcknowledgement)}\n`,
      "utf8",
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:12:00.000Z"));
    const hiddenBrokenEvidence = await command(root, [
      "search",
      "rollout",
      "action",
      "status",
      "--limit",
      "1",
      "--json",
    ]);
    vi.useRealTimers();
    expect(hiddenBrokenEvidence.code).toBe(1);
    expect(hiddenBrokenEvidence.error).toContain("observation_invalid");

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
