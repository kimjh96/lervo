import { describe, expect, it } from "vitest";

import {
  assertSearchRetrievalPlanActivation,
  assertSearchRetrievalPlanActivationBundle,
  createSearchRetrievalPlan,
  createSearchRetrievalPlanActivation,
  createSearchRetrievalPlanActivationBundle,
  createSearchRetrievalPlanPolicy,
  createSearchRetrievalPlanReview,
  createSearchRetrievalPlanRollback,
} from "../src/index.js";

function fixture() {
  const plan = createSearchRetrievalPlan({
    projection: {
      required: true,
      populations: [
        {
          populationId: "provider.codex",
          projector: {
            id: "provider_query_projection.codex",
            version: 1,
            buildId: `sqbuild_${"1".repeat(24)}`,
          },
        },
        {
          populationId: "provider.claude",
          projector: {
            id: "provider_query_projection.claude",
            version: 1,
            buildId: `sqbuild_${"2".repeat(24)}`,
          },
        },
      ],
      maximumQueries: 8,
      maximumQueryCharacters: 500,
    },
    retrieval: {
      stageId: "primary_retrieval",
      candidateId: "lexical-v2",
      engine: { id: "lexical", version: 2 },
      adapterBuildId: `sebuild_${"3".repeat(24)}`,
      perQueryLimit: 50,
    },
    fusion: { algorithm: "query_coverage_interleave", version: 1 },
    finalLimit: 10,
    failurePolicy: "fail_closed",
    privacy: {
      requestText: "excluded",
      contextText: "excluded",
      projectedQueryText: "excluded",
      credentials: "excluded",
    },
  });
  const review = createSearchRetrievalPlanReview({
    planId: plan.planId,
    reviewerId: "repository-owner",
    reviewedAt: "2026-08-31T07:00:00.000Z",
    decision: "activate",
    corpus: {
      sourceSnapshotId: `ksnap_${"4".repeat(24)}`,
      digest: `sha256:${"5".repeat(64)}`,
      documentCount: 455,
      byteCount: 1_800_000,
    },
    suite: {
      suiteId: "spbench_lexical_v2_real_use_reviewed.v1",
      bindingHash: `sha256:${"6".repeat(64)}`,
      cases: 4,
      repetitions: 5,
    },
    populations: [
      {
        populationId: "provider.codex",
        reportId: "lv2real_aaaaaaaaaaaaaaaaaaaaaaaa",
        reportHash: `sha256:${"7".repeat(64)}`,
        passedObservations: 20,
        totalObservations: 20,
        usageComplete: true,
        projectionFailures: 0,
        durationWithinLimit: true,
      },
      {
        populationId: "provider.claude",
        reportId: "lv2real_bbbbbbbbbbbbbbbbbbbbbbbb",
        reportHash: `sha256:${"8".repeat(64)}`,
        passedObservations: 20,
        totalObservations: 20,
        usageComplete: true,
        projectionFailures: 0,
        durationWithinLimit: true,
      },
    ],
    engineEvidence: {
      evidencePath: "docs/evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md",
      evidenceHash: `sha256:${"9".repeat(64)}`,
      qualityGatePassed: true,
      efficiencyGatePassed: true,
    },
  });
  const policy = createSearchRetrievalPlanPolicy({
    projectId: "prj_fixture_0001",
    allowedPlanIds: [plan.planId],
    reviewerIds: ["repository-owner"],
    operatorIds: ["repository-owner"],
    authorId: "repository-owner",
    createdAt: "2026-08-31T07:01:00.000Z",
    minimumPopulations: 2,
    requirePerfectObservationPass: true,
    requireCompleteUsage: true,
    requireZeroProjectionFailures: true,
    requireDurationWithinLimit: true,
  });
  return { plan, review, policy };
}

describe("search retrieval-plan activation", () => {
  it("binds the complete plan, both provider populations, activation, and rollback", () => {
    const bundle = createSearchRetrievalPlanActivationBundle(fixture());
    expect(() => assertSearchRetrievalPlanActivationBundle(bundle)).not.toThrow();
    const activation = createSearchRetrievalPlanActivation({
      bundle,
      operatorId: "repository-owner",
      decidedAt: new Date("2026-08-31T07:02:00.000Z"),
      previous: null,
    });
    expect(activation.selected).toMatchObject({ mode: "candidate", planId: bundle.plan.planId });
    const rollback = createSearchRetrievalPlanRollback({
      bundle,
      operatorId: "repository-owner",
      decidedAt: new Date("2026-08-31T07:03:00.000Z"),
      previous: activation,
    });
    expect(rollback.selected.mode).toBe("baseline");
    expect(() => assertSearchRetrievalPlanActivation(rollback, activation)).not.toThrow();
  });

  it("rejects a report population that did not pass every observation", () => {
    const fixtureValue = fixture();
    fixtureValue.review.populations[0]!.passedObservations = 19;
    expect(() => createSearchRetrievalPlanActivationBundle(fixtureValue)).toThrow(
      /unchanged gates/u,
    );
  });
});
