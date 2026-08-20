import { describe, expect, it } from "vitest";

import {
  assertSearchEvaluationBundle,
  assertSearchEvaluationCoverage,
  createSearchAssessment,
  createSearchAttempt,
  createSearchEvaluationBundle,
  createSearchEvaluationCase,
  createSearchEvaluationCoverage,
  LexicalSearchIndex,
  type SearchEvaluationCase,
  type SearchSourceInput,
} from "../src/index.js";

const CONTENT_HASH = `sha256:${"a".repeat(64)}`;

function evaluationCase(input: {
  query: string;
  nonce: string;
  minute: number;
  projectId?: string;
}): SearchEvaluationCase {
  const source: SearchSourceInput = {
    kind: "document",
    sourceId: "doc_bundle_guide_01",
    contentHash: CONTENT_HASH,
    path: "docs/bundle-guide.md",
    title: "평가 묶음 안내",
    labels: [],
    text: `검색 평가 표본 ${input.query} 문서입니다.`,
  };
  const response = new LexicalSearchIndex([source]).search(input.query, 5);
  const attempt = createSearchAttempt({
    projectId: input.projectId ?? "prj_search_bundle_01",
    observedAt: new Date(`2026-08-20T07:${String(input.minute).padStart(2, "0")}:00.000Z`),
    nonce: input.nonce.repeat(32),
    response,
  });
  const assessment = createSearchAssessment({
    attempt,
    assessedAt: new Date(`2026-08-20T08:${String(input.minute).padStart(2, "0")}:00.000Z`),
    assessor: "human",
    outcome: "accepted",
    selectedSources: [{ sourceKind: "document", sourceId: source.sourceId }],
  });
  return createSearchEvaluationCase({ attempt, assessment, query: input.query, maximumRank: 3 });
}

describe("search evaluation sample bundles", () => {
  it("selects active cases through acyclic replacements and reports sufficient samples", () => {
    const oldCase = evaluationCase({ query: "이전표본", nonce: "a", minute: 1 });
    const replacement = evaluationCase({ query: "새표본", nonce: "b", minute: 2 });
    const second = evaluationCase({ query: "추가표본", nonce: "c", minute: 3 });
    const bundle = createSearchEvaluationBundle({
      bundleId: "researcher.discovery",
      projectId: oldCase.projectId,
      roleId: "researcher",
      taskType: "source-discovery",
      minimumActiveCases: 2,
      activeCaseIds: [second.caseId, replacement.caseId],
      replacements: [{ replacedCaseId: oldCase.caseId, replacementCaseId: replacement.caseId }],
    });
    const coverage = createSearchEvaluationCoverage(bundle, [oldCase, replacement, second]);

    expect(bundle.activeCaseIds).toEqual([...bundle.activeCaseIds].sort());
    expect(coverage).toMatchObject({
      activeCases: 2,
      replacementCount: 1,
      shortfall: 0,
      sampleState: "sufficient",
      comparisonReadiness: "ready",
      embeddingDecision: "not_determined",
    });
    expect(JSON.stringify({ bundle, coverage })).not.toContain("이전표본");
  });

  it("keeps an undersized bundle explicitly ineligible for comparison", () => {
    const only = evaluationCase({ query: "단일표본", nonce: "d", minute: 4 });
    const bundle = createSearchEvaluationBundle({
      bundleId: "designer.tokens",
      projectId: only.projectId,
      roleId: "designer",
      taskType: "token-review",
      minimumActiveCases: 3,
      activeCaseIds: [only.caseId],
    });

    expect(createSearchEvaluationCoverage(bundle, [only])).toMatchObject({
      activeCases: 1,
      shortfall: 2,
      sampleState: "insufficient",
      comparisonReadiness: "insufficient_sample",
      embeddingDecision: "not_determined",
    });
  });

  it("rejects cycles, missing cases and duplicate active queries", () => {
    const first = evaluationCase({ query: "중복표본", nonce: "e", minute: 5 });
    const duplicateQuery = evaluationCase({ query: "중복표본", nonce: "f", minute: 6 });
    const terminal = evaluationCase({ query: "종료표본", nonce: "1", minute: 7 });

    expect(() => createSearchEvaluationBundle({
      bundleId: "general.cycle",
      projectId: first.projectId,
      roleId: "general",
      taskType: "cycle-check",
      minimumActiveCases: 1,
      activeCaseIds: [terminal.caseId],
      replacements: [
        { replacedCaseId: first.caseId, replacementCaseId: duplicateQuery.caseId },
        { replacedCaseId: duplicateQuery.caseId, replacementCaseId: first.caseId },
      ],
    })).toThrow(/순환/);

    const duplicateBundle = createSearchEvaluationBundle({
      bundleId: "general.duplicate",
      projectId: first.projectId,
      roleId: "general",
      taskType: "duplicate-check",
      minimumActiveCases: 2,
      activeCaseIds: [first.caseId, duplicateQuery.caseId],
    });
    expect(() => assertSearchEvaluationBundle(duplicateBundle, [first, duplicateQuery]))
      .toThrow(/query를 활성 표본으로 중복/);
    expect(() => assertSearchEvaluationBundle(duplicateBundle, [first])).toThrow(/없거나 다른 project/);
  });

  it("rejects changed bundle and coverage content", () => {
    const only = evaluationCase({ query: "변조표본", nonce: "2", minute: 8 });
    const bundle = createSearchEvaluationBundle({
      bundleId: "marketer.claims",
      projectId: only.projectId,
      roleId: "marketer",
      taskType: "claim-review",
      minimumActiveCases: 1,
      activeCaseIds: [only.caseId],
    });
    const coverage = createSearchEvaluationCoverage(bundle, [only]);

    expect(() => assertSearchEvaluationBundle({ ...bundle, minimumActiveCases: 2 })).toThrow(/hash/);
    expect(() => assertSearchEvaluationCoverage({ ...coverage, shortfall: 1 })).toThrow();
  });
});
