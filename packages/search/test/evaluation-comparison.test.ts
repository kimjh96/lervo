import { describe, expect, it } from "vitest";

import {
  assertSearchEvaluationComparison,
  assertSearchCandidateReview,
  assertSearchCandidateVerificationReceipt,
  contentId,
  createSearchEvaluationComparison,
  createSearchCandidateReview,
  createSearchCandidateVerificationReceipt,
  type CurrentSearchCandidateReview,
  type CurrentSearchEvaluationComparison,
  type LegacySearchCandidateReview,
  type LegacySearchEvaluationComparison,
} from "../src/index.js";
import { comparisonFixture } from "./evaluation-comparison-fixture.js";

function legacyComparison(
  comparison: CurrentSearchEvaluationComparison,
): LegacySearchEvaluationComparison {
  const {
    schemaVersion: _schema,
    comparisonId: _id,
    candidateAdapterBuildId: _build,
    ...core
  } = comparison;
  return { schemaVersion: 1, comparisonId: contentId("secmp", core), ...core };
}

function legacyReview(
  review: CurrentSearchCandidateReview,
  comparison: LegacySearchEvaluationComparison,
): LegacySearchCandidateReview {
  const {
    schemaVersion: _schema,
    reviewId: _id,
    candidateAdapterBuildId: _build,
    comparisonId: _comparisonId,
    ...rest
  } = review;
  const core = { ...rest, comparisonId: comparison.comparisonId };
  return { schemaVersion: 1, reviewId: contentId("scrv", core), ...core };
}

describe("search evaluation candidate comparison", () => {
  it("compares pass/fail under the same cases without comparing engine scores", async () => {
    const evidence = await comparisonFixture();
    const comparison = createSearchEvaluationComparison({
      evidence,
      candidateAdapterBuildId: evidence.candidateAdapterBuildId,
    });

    expect(comparison).toMatchObject({
      totalCases: 2,
      baselineWins: 0,
      candidateWins: 1,
      ties: 1,
      observedOutcome: "candidate_better_observed",
      candidateDecision: "not_determined",
      embeddingDecision: "not_determined",
    });
    expect(comparison.cases.map((item) => item.outcome).sort()).toEqual(["candidate_win", "tie"]);
    expect(comparison).toMatchObject({
      schemaVersion: 2,
      candidateAdapterBuildId: evidence.candidateAdapterBuildId,
    });
    expect(() =>
      assertSearchEvaluationComparison(legacyComparison(comparison), evidence),
    ).not.toThrow();
    expect(JSON.stringify(comparison)).not.toContain("apple");
  });

  it("refuses comparison when the bundle has not reached its declared sample minimum", async () => {
    const evidence = await comparisonFixture(3);
    expect(evidence.coverage.comparisonReadiness).toBe("insufficient_sample");
    expect(() =>
      createSearchEvaluationComparison({
        evidence,
        candidateAdapterBuildId: evidence.candidateAdapterBuildId,
      }),
    ).toThrow(/sample is insufficient/);
  });

  it("rejects tampered aggregates and a candidate using the baseline identity", async () => {
    const evidence = await comparisonFixture();
    const comparison = createSearchEvaluationComparison({
      evidence,
      candidateAdapterBuildId: evidence.candidateAdapterBuildId,
    });
    expect(() => assertSearchEvaluationComparison({ ...comparison, candidateWins: 2 })).toThrow();
    expect(() =>
      assertSearchEvaluationComparison({
        ...comparison,
        candidate: { ...comparison.candidate, engine: comparison.baseline.engine },
      }),
    ).toThrow(/Baseline or candidate search engine coordinates/);
    expect(() =>
      assertSearchEvaluationComparison(comparison, {
        ...evidence,
        corpus: evidence.corpus.map((source) => ({ ...source, text: `${source.text} changed` })),
      }),
    ).toThrow(/Engine, project, timestamp, or case coordinates/);
  });

  it("records an eligible review only after the candidate replay matches exactly", async () => {
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

    expect(review).toMatchObject({
      schemaVersion: 2,
      candidateAdapterBuildId: evidence.candidateAdapterBuildId,
      totalCases: 2,
      baselineWins: 0,
      candidateWins: 1,
      ties: 1,
      verification: { comparisonIntegrity: "verified", candidateReplay: "matched" },
      promotionReadiness: "eligible_for_activation_review",
      activationState: "not_applied",
      embeddingDecision: "not_determined",
    });
    expect(JSON.stringify(review)).not.toContain("apple");
    const receipt = createSearchCandidateVerificationReceipt({
      review,
      comparison,
      adapterBuildId: evidence.candidateAdapterBuildId,
      replayRunId: evidence.candidate.run.runId,
      indexId: evidence.candidate.run.indexId,
    });
    expect(receipt).toMatchObject({
      verificationState: "replayed",
      adapterBuildId: evidence.candidateAdapterBuildId,
      reviewId: review.reviewId,
    });
    expect(
      createSearchCandidateVerificationReceipt({
        review,
        comparison,
        adapterBuildId: evidence.candidateAdapterBuildId,
        replayRunId: evidence.candidate.run.runId,
        indexId: evidence.candidate.run.indexId,
      }).receiptId,
    ).toBe(receipt.receiptId);
    expect(() =>
      assertSearchCandidateVerificationReceipt({
        ...receipt,
        adapterBuildId: contentId("sebuild", { adapter: "fixture_candidate", revision: 2 }),
      }),
    ).toThrow();
    expect(() =>
      assertSearchCandidateReview(legacyReview(review, legacyComparison(comparison))),
    ).not.toThrow();
    expect(() => assertSearchCandidateReview({ ...review, totalCases: 3 })).toThrow();
    expect(() =>
      createSearchCandidateReview({
        comparison,
        candidateId: "fixture-v1",
        cases: evidence.cases,
        replay: evidence.baseline,
        candidateAdapterBuildId: evidence.candidateAdapterBuildId,
        reviewerId: "reviewer_search",
        reviewedAt: new Date("2026-08-20T04:00:00.000Z"),
        decision: "adopt_candidate",
      }),
    ).toThrow(/replay coordinates/);
    expect(() =>
      createSearchCandidateReview({
        comparison,
        candidateId: "fixture-v1",
        cases: evidence.cases,
        replay: evidence.candidate,
        candidateAdapterBuildId: contentId("sebuild", {
          adapter: "fixture_candidate",
          revision: 2,
        }),
        reviewerId: "reviewer_search",
        reviewedAt: new Date("2026-08-20T04:00:00.000Z"),
        decision: "adopt_candidate",
      }),
    ).toThrow(/replay coordinates/);
  });

  it("keeps rejection and more-sample decisions distinct and refuses unsupported adoption", async () => {
    const evidence = await comparisonFixture(2, false);
    const comparison = createSearchEvaluationComparison({
      evidence,
      candidateAdapterBuildId: evidence.candidateAdapterBuildId,
    });
    const shared = {
      comparison,
      candidateId: "fixture-v1",
      cases: evidence.cases,
      replay: evidence.candidate,
      candidateAdapterBuildId: evidence.candidateAdapterBuildId,
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T04:01:00.000Z"),
    };

    expect(createSearchCandidateReview({ ...shared, decision: "reject_candidate" })).toMatchObject({
      promotionReadiness: "rejected",
      activationState: "not_applied",
    });
    expect(
      createSearchCandidateReview({ ...shared, decision: "more_samples_required" }),
    ).toMatchObject({
      promotionReadiness: "more_evidence_required",
      activationState: "not_applied",
    });
    expect(() => createSearchCandidateReview({ ...shared, decision: "adopt_candidate" })).toThrow(
      /cannot be reviewed for adoption/,
    );
  });
});
