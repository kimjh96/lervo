import { describe, expect, it } from "vitest";

import {
  assertSearchEvaluationCase,
  assertSearchEvaluationResult,
  createSearchAssessment,
  createSearchAttempt,
  createSearchEvaluationCase,
  createSearchEvaluationResult,
  createSearchEvaluationRun,
  LexicalSearchIndex,
  type SearchSourceInput,
} from "../src/index.js";

const GUIDE_HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;

function corpus(guideText = "Operational guidance for evaluating search failures."): SearchSourceInput[] {
  return [
    {
      kind: "document",
      sourceId: "doc_search_guide_01",
      contentHash: GUIDE_HASH,
      path: "docs/search-guide.md",
      title: "Search operations guide",
      labels: ["search"],
      text: guideText,
    },
    {
      kind: "document",
      sourceId: "doc_other_guide_01",
      contentHash: OTHER_HASH,
      path: "docs/other.md",
      title: "Other document",
      labels: [],
      text: "Unrelated content.",
    },
  ];
}

function reviewedCase() {
  const response = new LexicalSearchIndex(corpus()).search("evaluating failures", 10);
  const attempt = createSearchAttempt({
    projectId: "prj_search_eval_01",
    observedAt: new Date("2026-08-20T05:00:00.000Z"),
    nonce: "a".repeat(32),
    response,
  });
  const assessment = createSearchAssessment({
    attempt,
    assessedAt: new Date("2026-08-20T05:01:00.000Z"),
    assessor: "human",
    outcome: "accepted",
    selectedSources: [{ sourceKind: "document", sourceId: "doc_search_guide_01" }],
  });
  return {
    attempt,
    assessment,
    evaluationCase: createSearchEvaluationCase({
      attempt,
      assessment,
      query: "evaluating failures",
      maximumRank: 3,
    }),
  };
}

describe("reusable search evaluation", () => {
  it("turns only reviewed sources into a content-bound case", () => {
    const { attempt, assessment, evaluationCase } = reviewedCase();

    expect(evaluationCase).toMatchObject({
      query: "evaluating failures",
      expectation: {
        matchMode: "any",
        maximumRank: 3,
        sources: [{ sourceKind: "document", sourceId: "doc_search_guide_01" }],
      },
      review: {
        attemptId: attempt.attemptId,
        assessmentId: assessment.assessmentId,
        outcome: "accepted",
        referenceStatus: "passed",
      },
    });
    expect(() => createSearchEvaluationCase({
      attempt,
      assessment,
      query: "evaluating failures",
      maximumRank: 3,
      sources: [{ sourceKind: "document", sourceId: "doc_unreviewed_01" }],
    })).toThrow(/expected or accepted by the reviewer/);
    expect(() => createSearchEvaluationCase({
      attempt,
      assessment,
      query: "evaluating failures",
      maximumRank: attempt.requestedLimit + 1,
    })).toThrow(/result limit observed/);
  });

  it("detects a regression without making an embedding decision", () => {
    const { evaluationCase } = reviewedCase();
    const current = new LexicalSearchIndex(corpus("No relevant terms remain.")).search("evaluating failures", 50);
    const result = createSearchEvaluationResult({
      evaluationCase,
      response: current,
      evaluatedAt: new Date("2026-08-20T06:00:00.000Z"),
    });
    const run = createSearchEvaluationRun({
      projectId: evaluationCase.projectId,
      evaluatedAt: new Date("2026-08-20T06:00:00.000Z"),
      cases: [evaluationCase],
      results: [result],
    });

    expect(result).toMatchObject({
      status: "failed",
      failureReason: "no_results",
      comparisonToReference: "regressed",
      embeddingDecision: "not_determined",
    });
    expect(run).toMatchObject({
      failedCases: 1,
      regressions: 1,
      baselineState: "failures_observed",
      embeddingDecision: "not_determined",
    });
  });

  it("observes an improvement from a reviewed failed attempt", () => {
    const response = new LexicalSearchIndex(corpus("No relevant terms")).search("evaluating failures", 10);
    const attempt = createSearchAttempt({
      projectId: "prj_search_eval_01",
      observedAt: new Date("2026-08-20T05:00:00.000Z"),
      nonce: "b".repeat(32),
      response,
    });
    const assessment = createSearchAssessment({
      attempt,
      assessedAt: new Date("2026-08-20T05:01:00.000Z"),
      assessor: "verification",
      outcome: "failed",
      failureReason: "expected_source_missing",
      expectedSources: [{ sourceKind: "document", sourceId: "doc_search_guide_01" }],
    });
    const evaluationCase = createSearchEvaluationCase({
      attempt,
      assessment,
      query: "evaluating failures",
      maximumRank: 3,
    });
    const result = createSearchEvaluationResult({
      evaluationCase,
      response: new LexicalSearchIndex(corpus()).search("evaluating failures", 50),
      evaluatedAt: new Date("2026-08-20T06:00:00.000Z"),
    });

    expect(evaluationCase.review.referenceStatus).toBe("failed");
    expect(result).toMatchObject({ status: "passed", comparisonToReference: "improved" });
  });

  it("rejects a different query and content tampering", () => {
    const { attempt, assessment, evaluationCase } = reviewedCase();
    expect(() => createSearchEvaluationCase({
      attempt,
      assessment,
      query: "different query",
      maximumRank: 3,
    })).toThrow(/query coordinates/);

    expect(() => assertSearchEvaluationCase({
      ...evaluationCase,
      expectation: { ...evaluationCase.expectation, maximumRank: 4 },
    })).toThrow(/ID does not match its content/);

    const result = createSearchEvaluationResult({
      evaluationCase,
      response: new LexicalSearchIndex(corpus()).search("evaluating failures", 50),
      evaluatedAt: new Date("2026-08-20T06:00:00.000Z"),
    });
    expect(() => assertSearchEvaluationResult({ ...result, returnedHits: 0 })).toThrow();
  });
});
