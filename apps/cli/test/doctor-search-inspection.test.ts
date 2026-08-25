import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import {
  contentId,
  createSearchRolloutActionPolicy,
  createSearchRolloutReviewPolicy,
} from "@lervo/search";
import {
  applyLocalSearchRolloutAction,
  recordSearchRolloutActionPolicy,
  recordSearchRolloutReviewPolicy,
  reviewLocalSearchRollout,
} from "@lervo/search-local";
import { afterEach, describe, expect, it } from "vitest";

import { inspectDoctorSearch } from "../src/doctor-search-inspection.js";
import { searchCandidateRegistry } from "../src/search-candidate-registry.js";
import {
  cleanupSearchComparisonRepositories,
  repository,
} from "./search-evaluation-comparison-fixture.js";
import { prepareSelectedSearchCandidate } from "./search-selected-candidate-fixture.js";

afterEach(cleanupSearchComparisonRepositories);

describe("doctor search rollout inspection", () => {
  it("treats an empty but inspectable search environment as healthy", async () => {
    const root = await repository();
    const project = await loadProjectManifest(root);
    const inspections = await inspectDoctorSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry: searchCandidateRegistry,
      observedAt: new Date("2026-08-20T10:00:00.000Z"),
    });

    expect(inspections.map((item) => item.check)).toEqual([
      { checkId: "search_engine_selection", status: "healthy", observedCount: 0 },
      { checkId: "search_rollout_policies", status: "healthy", observedCount: 0 },
      { checkId: "search_rollout_reviews", status: "healthy", observedCount: 0 },
      { checkId: "search_rollout_actions", status: "healthy", observedCount: 0 },
    ]);
  });

  it("separates broken actions from reviews and marks dependent action checks unknown", async () => {
    const { root, project, activation, registry } = await prepareSelectedSearchCandidate(
      "researcher.doctor-rollout",
    );
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
    const review = await reviewLocalSearchRollout({
      repositoryRoot: root,
      projectId: project.projectId,
      selectionTransitionId: activation.activationId,
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T10:03:00.000Z"),
      decision: "keep_candidate",
      policyId: rolloutPolicy.policyId,
    });
    const actionPolicy = createSearchRolloutActionPolicy({
      rolloutPolicy,
      action: "acknowledge_keep",
      allowedOperatorIds: ["operator_search"],
      authoredBy: "operator_search",
      createdAt: new Date("2026-08-20T10:03:30.000Z"),
    });
    await recordSearchRolloutActionPolicy(root, actionPolicy);
    await applyLocalSearchRolloutAction({
      repositoryRoot: root,
      projectId: project.projectId,
      rolloutReviewId: review.rolloutReviewId,
      actionPolicyId: actionPolicy.actionPolicyId,
      requestedAction: "acknowledge_keep",
      operatorId: "operator_search",
      actedAt: new Date("2026-08-20T10:04:00.000Z"),
      registry,
    });
    const inspect = () =>
      inspectDoctorSearch({
        repositoryRoot: root,
        projectId: project.projectId,
        registry,
        observedAt: new Date("2026-08-20T10:05:00.000Z"),
      });
    const healthy = await inspect();
    expect(healthy.map((item) => item.check)).toEqual([
      { checkId: "search_engine_selection", status: "healthy", observedCount: 1 },
      { checkId: "search_rollout_policies", status: "healthy", observedCount: 3 },
      { checkId: "search_rollout_reviews", status: "healthy", observedCount: 1 },
      { checkId: "search_rollout_actions", status: "healthy", observedCount: 1 },
    ]);

    const acknowledgementDirectory = resolve(root, ".lervo/state/search/rollout-acknowledgements");
    const acknowledgementName = (await readdir(acknowledgementDirectory))[0]!;
    const acknowledgementPath = resolve(acknowledgementDirectory, acknowledgementName);
    const originalAcknowledgement = await readFile(acknowledgementPath, "utf8");
    const forged = JSON.parse(originalAcknowledgement) as Record<string, unknown> & {
      acknowledgementId: string;
      qualityInputDigest: string;
    };
    forged.qualityInputDigest = `sha256:${"f".repeat(64)}`;
    const { schemaVersion: _schema, acknowledgementId: _id, ...core } = forged;
    forged.acknowledgementId = contentId("srack", core);
    const forgedPath = resolve(acknowledgementDirectory, `${forged.acknowledgementId}.json`);
    await rename(acknowledgementPath, forgedPath);
    await writeFile(forgedPath, `${JSON.stringify(forged)}\n`);
    const brokenAction = await inspect();
    expect(
      brokenAction.find((item) => item.check.checkId === "search_rollout_reviews")?.check.status,
    ).toBe("healthy");
    expect(
      brokenAction.find((item) => item.check.checkId === "search_rollout_actions"),
    ).toMatchObject({
      check: { status: "unhealthy" },
      issues: [{ code: "search_rollout_action_invalid" }],
    });

    await rename(forgedPath, acknowledgementPath);
    await writeFile(acknowledgementPath, originalAcknowledgement);
    const reviewPath = resolve(
      root,
      ".lervo/state/search/rollout-reviews",
      `${review.rolloutReviewId}.json`,
    );
    await writeFile(reviewPath, "{}\n");
    const brokenReview = await inspect();
    expect(
      brokenReview.find((item) => item.check.checkId === "search_rollout_reviews"),
    ).toMatchObject({
      check: { status: "unhealthy" },
      issues: [{ code: "search_rollout_review_invalid" }],
    });
    expect(
      brokenReview.find((item) => item.check.checkId === "search_rollout_actions"),
    ).toMatchObject({
      check: { status: "unknown" },
      issues: [{ code: "search_rollout_action_unavailable" }],
    });

    await writeFile(reviewPath, `${JSON.stringify(review)}\n`);
    const actionPolicyPath = resolve(
      root,
      ".lervo/search-rollout-action-policies",
      `${actionPolicy.actionPolicyId}.yaml`,
    );
    await writeFile(actionPolicyPath, "{}\n");
    const brokenPolicy = await inspect();
    expect(
      brokenPolicy.find((item) => item.check.checkId === "search_rollout_policies"),
    ).toMatchObject({
      check: { status: "unhealthy" },
      issues: [{ code: "search_rollout_policy_invalid" }],
    });
    expect(
      brokenPolicy.find((item) => item.check.checkId === "search_rollout_reviews")?.check.status,
    ).toBe("unknown");
    expect(
      brokenPolicy.find((item) => item.check.checkId === "search_rollout_actions")?.check.status,
    ).toBe("unknown");
  });
});
