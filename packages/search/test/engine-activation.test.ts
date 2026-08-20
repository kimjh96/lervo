import { describe, expect, it } from "vitest";

import {
  assertSearchEngineActivation,
  createSearchCandidateReview,
  createSearchEngineActivationPolicy,
  createSearchEngineCandidateActivation,
  createSearchEngineCandidateRefresh,
  createSearchEngineRollback,
  createSearchEvaluationComparison,
  contentId,
  type LegacySearchEngineActivation,
} from "../src/index.js";
import { comparisonFixture } from "./evaluation-comparison-fixture.js";

async function activationFixture() {
  const evidence = await comparisonFixture();
  const comparison = createSearchEvaluationComparison({
    evidence,
    candidateAdapterBuildId: evidence.candidateAdapterBuildId,
  });
  const review = createSearchCandidateReview({
    comparison,
    candidateId: "fixture-v1",
    cases: evidence.cases,
    replay: evidence.candidate,
    candidateAdapterBuildId: evidence.candidateAdapterBuildId,
    reviewerId: "reviewer_search",
    reviewedAt: new Date("2026-08-20T04:00:00.000Z"),
    decision: "adopt_candidate",
  });
  const policy = createSearchEngineActivationPolicy({
    projectId: comparison.projectId,
    allowedReviewerIds: ["reviewer_search"],
    allowedOperatorIds: ["operator_search"],
    allowedCandidateIds: ["fixture-v1"],
    minimumCandidateWins: 1,
    authoredBy: "operator_search",
    createdAt: new Date("2026-08-20T05:00:00.000Z"),
  });
  return { comparison, evidence, review, policy };
}

describe("search engine activation policy and rollback", () => {
  it("records a policy-bound candidate selection and an exact rollback transition", async () => {
    const fixture = await activationFixture();
    const activation = createSearchEngineCandidateActivation({
      ...fixture,
      previous: null,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T06:00:00.000Z"),
    });
    const rollback = createSearchEngineRollback({
      policy: fixture.policy,
      previous: activation,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T07:00:00.000Z"),
    });

    expect(activation).toMatchObject({
      sequence: 1,
      previousActivationId: null,
      action: "activate_candidate",
      previousSelection: { mode: "baseline", engine: { id: "lexical", version: 1 } },
      selected: { mode: "candidate", candidateId: "fixture-v1", reviewId: fixture.review.reviewId },
      fallbackSelection: { mode: "baseline" },
      fallbackActivationId: null,
      recordState: "selection_recorded",
      embeddingDecision: "not_determined",
    });
    expect(rollback).toMatchObject({
      sequence: 2,
      previousActivationId: activation.activationId,
      action: "rollback",
      selected: { mode: "baseline", engine: { id: "lexical", version: 1 } },
      rollbackOfActivationId: activation.activationId,
      fallbackSelection: activation.selected,
      fallbackActivationId: activation.activationId,
      recordState: "selection_recorded",
    });
    expect(() => assertSearchEngineActivation(rollback, activation)).not.toThrow();
    expect(JSON.stringify([activation, rollback])).not.toContain("사과");

    const {
      schemaVersion: _schemaVersion,
      activationId: _activationId,
      fallbackSelection: _fallbackSelection,
      fallbackActivationId: _fallbackActivationId,
      recordState: _recordState,
      ...legacyCore
    } = activation;
    const legacyContent = {
      ...legacyCore,
      rollbackTargetActivationId: null,
      applicationState: "not_connected" as const,
    };
    const legacy: LegacySearchEngineActivation = {
      schemaVersion: 1,
      activationId: contentId("seact", legacyContent),
      ...legacyContent,
    };
    expect(() => assertSearchEngineActivation(legacy)).not.toThrow();
    const interimContent = {
      ...legacyCore,
      rollbackTargetActivationId: null,
      recordState: "selection_recorded" as const,
    };
    const interim: LegacySearchEngineActivation = {
      schemaVersion: 1,
      activationId: contentId("seact", interimContent),
      ...interimContent,
    };
    expect(() => assertSearchEngineActivation(interim)).not.toThrow();
  });

  it("rejects unauthorized, under-threshold, repeated, and broken-chain activation", async () => {
    const fixture = await activationFixture();
    const create = (overrides: Partial<Parameters<typeof createSearchEngineCandidateActivation>[0]> = {}) =>
      createSearchEngineCandidateActivation({
        ...fixture,
        previous: null,
        operatorId: "operator_search",
        decidedAt: new Date("2026-08-20T06:00:00.000Z"),
        ...overrides,
      });
    expect(() => create({ operatorId: "operator_other" })).toThrow(/operator/);
    expect(() => create({
      policy: createSearchEngineActivationPolicy({
        projectId: fixture.comparison.projectId,
        allowedReviewerIds: ["reviewer_other"],
        allowedOperatorIds: ["operator_search"],
        allowedCandidateIds: ["fixture-v1"],
        minimumCandidateWins: 1,
        authoredBy: "operator_search",
        createdAt: new Date("2026-08-20T05:01:00.000Z"),
      }),
    })).toThrow(/정책을 충족하지 않습니다/);
    expect(() => create({
      policy: createSearchEngineActivationPolicy({
        projectId: fixture.comparison.projectId,
        allowedReviewerIds: ["reviewer_search"],
        allowedOperatorIds: ["operator_search"],
        allowedCandidateIds: ["fixture-v1"],
        minimumCandidateWins: 2,
        authoredBy: "operator_search",
        createdAt: new Date("2026-08-20T05:02:00.000Z"),
      }),
    })).toThrow(/정책을 충족하지 않습니다/);
    const activation = create();
    expect(() => create({ previous: activation })).toThrow(/refresh/);
    expect(() => assertSearchEngineActivation({ ...activation, sequence: 2 }, null)).toThrow();
    expect(() => assertSearchEngineActivation({ ...activation, projectId: "prj_other" }, activation)).toThrow();
  });

  it("refreshes only the selected candidate evidence and keeps baseline as the safe fallback", async () => {
    const fixture = await activationFixture();
    const activation = createSearchEngineCandidateActivation({
      ...fixture,
      previous: null,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T06:00:00.000Z"),
    });
    const refreshedReview = createSearchCandidateReview({
      comparison: fixture.comparison,
      candidateId: "fixture-v1",
      cases: fixture.evidence.cases,
      replay: fixture.evidence.candidate,
      candidateAdapterBuildId: fixture.evidence.candidateAdapterBuildId,
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T06:30:00.000Z"),
      decision: "adopt_candidate",
    });
    const refresh = createSearchEngineCandidateRefresh({
      policy: fixture.policy,
      review: refreshedReview,
      comparison: fixture.comparison,
      previous: activation,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T07:00:00.000Z"),
    });
    const rollback = createSearchEngineRollback({
      policy: fixture.policy,
      previous: refresh,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T08:00:00.000Z"),
    });

    expect(refresh).toMatchObject({
      sequence: 2,
      previousActivationId: activation.activationId,
      action: "refresh_candidate",
      previousSelection: activation.selected,
      selected: {
        mode: "candidate",
        candidateId: "fixture-v1",
        reviewId: refreshedReview.reviewId,
      },
      fallbackSelection: { mode: "baseline" },
      fallbackActivationId: null,
    });
    expect(rollback).toMatchObject({
      action: "rollback",
      previousActivationId: refresh.activationId,
      selected: { mode: "baseline" },
    });
    expect(() => assertSearchEngineActivation(refresh, activation)).not.toThrow();
    expect(() => createSearchEngineCandidateRefresh({
      policy: fixture.policy,
      review: fixture.review,
      comparison: fixture.comparison,
      previous: activation,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T07:00:00.000Z"),
    })).toThrow(/같은 검토·비교 원본/);
  });
});
