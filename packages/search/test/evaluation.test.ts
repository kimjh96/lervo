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

function corpus(guideText = "검색 실패를 평가하는 운영 안내입니다."): SearchSourceInput[] {
  return [
    {
      kind: "document",
      sourceId: "doc_search_guide_01",
      contentHash: GUIDE_HASH,
      path: "docs/search-guide.md",
      title: "검색 운영 안내",
      labels: ["search"],
      text: guideText,
    },
    {
      kind: "document",
      sourceId: "doc_other_guide_01",
      contentHash: OTHER_HASH,
      path: "docs/other.md",
      title: "다른 문서",
      labels: [],
      text: "관련 없는 내용입니다.",
    },
  ];
}

function reviewedCase() {
  const response = new LexicalSearchIndex(corpus()).search("실패를 평가하는", 10);
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
      query: "실패를 평가하는",
      maximumRank: 3,
    }),
  };
}

describe("reusable search evaluation", () => {
  it("turns only reviewed sources into a content-bound case", () => {
    const { attempt, assessment, evaluationCase } = reviewedCase();

    expect(evaluationCase).toMatchObject({
      query: "실패를 평가하는",
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
      query: "실패를 평가하는",
      maximumRank: 3,
      sources: [{ sourceKind: "document", sourceId: "doc_unreviewed_01" }],
    })).toThrow(/평가자가 기대하거나 수락한/);
    expect(() => createSearchEvaluationCase({
      attempt,
      assessment,
      query: "실패를 평가하는",
      maximumRank: attempt.requestedLimit + 1,
    })).toThrow(/관측한 결과 한도/);
  });

  it("detects a regression without making an embedding decision", () => {
    const { evaluationCase } = reviewedCase();
    const current = new LexicalSearchIndex(corpus("이제 관련 단어가 없습니다.")).search("실패를 평가하는", 50);
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
    const response = new LexicalSearchIndex(corpus("관련 단어 없음")).search("실패를 평가하는", 10);
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
      query: "실패를 평가하는",
      maximumRank: 3,
    });
    const result = createSearchEvaluationResult({
      evaluationCase,
      response: new LexicalSearchIndex(corpus()).search("실패를 평가하는", 50),
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
      query: "다른 질의",
      maximumRank: 3,
    })).toThrow(/질의 좌표/);

    expect(() => assertSearchEvaluationCase({
      ...evaluationCase,
      expectation: { ...evaluationCase.expectation, maximumRank: 4 },
    })).toThrow(/ID가 실제 내용/);

    const result = createSearchEvaluationResult({
      evaluationCase,
      response: new LexicalSearchIndex(corpus()).search("실패를 평가하는", 50),
      evaluatedAt: new Date("2026-08-20T06:00:00.000Z"),
    });
    expect(() => assertSearchEvaluationResult({ ...result, returnedHits: 0 })).toThrow();
  });
});
