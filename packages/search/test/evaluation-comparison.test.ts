import { describe, expect, it } from "vitest";

import {
  assertSearchEvaluationComparison,
  assertSearchCandidateReview,
  createSearchEvaluationComparison,
  createSearchCandidateReview,
} from "../src/index.js";
import { comparisonFixture } from "./evaluation-comparison-fixture.js";

describe("search evaluation candidate comparison", () => {
  it("compares pass/fail under the same cases without comparing engine scores", async () => {
    const evidence = await comparisonFixture();
    const comparison = createSearchEvaluationComparison({ evidence });

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
    expect(JSON.stringify(comparison)).not.toContain("사과");
  });

  it("refuses comparison when the bundle has not reached its declared sample minimum", async () => {
    const evidence = await comparisonFixture(3);
    expect(evidence.coverage.comparisonReadiness).toBe("insufficient_sample");
    expect(() => createSearchEvaluationComparison({ evidence }))
      .toThrow(/표본이 충분하지 않아/);
  });

  it("rejects tampered aggregates and a candidate using the baseline identity", async () => {
    const evidence = await comparisonFixture();
    const comparison = createSearchEvaluationComparison({ evidence });
    expect(() => assertSearchEvaluationComparison({ ...comparison, candidateWins: 2 })).toThrow();
    expect(() => assertSearchEvaluationComparison({
      ...comparison,
      candidate: { ...comparison.candidate, engine: comparison.baseline.engine },
    })).toThrow(/Baseline과 후보/);
    expect(() => assertSearchEvaluationComparison(comparison, {
      ...evidence,
      corpus: evidence.corpus.map((source) => ({ ...source, text: `${source.text} 변경` })),
    })).toThrow(/엔진·project·시각·case 좌표/);
  });

  it("records an eligible review only after the candidate replay matches exactly", async () => {
    const evidence = await comparisonFixture();
    const comparison = createSearchEvaluationComparison({ evidence });
    const review = createSearchCandidateReview({
      comparison,
      candidateId: "fixture-v1",
      cases: evidence.cases,
      replay: evidence.candidate,
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T04:00:00.000Z"),
      decision: "adopt_candidate",
    });

    expect(review).toMatchObject({
      totalCases: 2,
      baselineWins: 0,
      candidateWins: 1,
      ties: 1,
      verification: { comparisonIntegrity: "verified", candidateReplay: "matched" },
      promotionReadiness: "eligible_for_activation_review",
      activationState: "not_applied",
      embeddingDecision: "not_determined",
    });
    expect(JSON.stringify(review)).not.toContain("사과");
    expect(() => assertSearchCandidateReview({ ...review, totalCases: 3 })).toThrow();
    expect(() => createSearchCandidateReview({
      comparison,
      candidateId: "fixture-v1",
      cases: evidence.cases,
      replay: evidence.baseline,
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T04:00:00.000Z"),
      decision: "adopt_candidate",
    })).toThrow(/replay 좌표/);
  });

  it("keeps rejection and more-sample decisions distinct and refuses unsupported adoption", async () => {
    const evidence = await comparisonFixture(2, false);
    const comparison = createSearchEvaluationComparison({ evidence });
    const shared = {
      comparison,
      candidateId: "fixture-v1",
      cases: evidence.cases,
      replay: evidence.candidate,
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T04:01:00.000Z"),
    };

    expect(createSearchCandidateReview({ ...shared, decision: "reject_candidate" }))
      .toMatchObject({ promotionReadiness: "rejected", activationState: "not_applied" });
    expect(createSearchCandidateReview({ ...shared, decision: "more_samples_required" }))
      .toMatchObject({ promotionReadiness: "more_evidence_required", activationState: "not_applied" });
    expect(() => createSearchCandidateReview({ ...shared, decision: "adopt_candidate" }))
      .toThrow(/채택 후보로 검토할 수 없습니다/);
  });
});
