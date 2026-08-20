import { describe, expect, it } from "vitest";

import {
  assertSearchEvaluationComparison,
  canonicalHash,
  contentId,
  createSearchAssessment,
  createSearchAttempt,
  createSearchEvaluationBundle,
  createSearchEvaluationCase,
  createSearchEvaluationComparison,
  createSearchEvaluationCoverage,
  executeSearchEvaluation,
  identifySearchQuery,
  LexicalSearchIndex,
  type SearchEngineIdentity,
  type SearchEvaluationCase,
  type SearchEvaluationIndexPort,
  type SearchHit,
  type SearchSourceInput,
} from "../src/index.js";

const CONTENT_HASH = `sha256:${"a".repeat(64)}`;
const CURRENT_HASH = `sha256:${"b".repeat(64)}`;
const CANDIDATE_ENGINE: SearchEngineIdentity = { id: "fixture_candidate", version: 1 };

function reviewedCase(query: string, sourceId: string, nonce: string, minute: number): SearchEvaluationCase {
  const source: SearchSourceInput = {
    kind: "document",
    sourceId,
    contentHash: CONTENT_HASH,
    labels: [],
    text: query,
  };
  const response = new LexicalSearchIndex([source]).search(query, 5);
  const attempt = createSearchAttempt({
    projectId: "prj_search_compare_01",
    observedAt: new Date(`2026-08-20T01:${String(minute).padStart(2, "0")}:00.000Z`),
    nonce: nonce.repeat(32),
    response,
  });
  const assessment = createSearchAssessment({
    attempt,
    assessedAt: new Date(`2026-08-20T02:${String(minute).padStart(2, "0")}:00.000Z`),
    assessor: "human",
    outcome: "accepted",
    selectedSources: [{ sourceKind: "document", sourceId }],
  });
  return createSearchEvaluationCase({ attempt, assessment, query, maximumRank: 3 });
}

function candidateIndex(
  corpus: readonly SearchSourceInput[],
  recoveredQuery: string,
  recoveredSourceId: string,
): SearchEvaluationIndexPort {
  const lexical = new LexicalSearchIndex(corpus);
  const indexId = contentId("sidx", { engine: CANDIDATE_ENGINE, corpusDigest: lexical.corpusDigest });
  return {
    engine: CANDIDATE_ENGINE,
    indexId,
    search(query, limit) {
      const lexicalResponse = lexical.search(query, limit);
      let hits = lexicalResponse.hits;
      if (query === recoveredQuery) {
        const source = corpus.find((item) => item.sourceId === recoveredSourceId)!;
        hits = [{
          source: { kind: source.kind, sourceId: source.sourceId, contentHash: source.contentHash },
          rank: 1,
          score: 1,
          matchedFields: ["text"],
        } satisfies SearchHit];
      }
      return {
        ...lexicalResponse,
        engine: CANDIDATE_ENGINE,
        indexId,
        ...identifySearchQuery(query),
        hits,
        resultSetHash: canonicalHash(hits.map((hit) => ({
          sourceKind: hit.source.kind,
          sourceId: hit.source.sourceId,
          contentHash: hit.source.contentHash,
          rank: hit.rank,
          score: hit.score,
        }))),
      };
    },
  };
}

async function comparisonFixture(minimumActiveCases = 2) {
  const recovered = reviewedCase("사과", "doc_compare_apple", "a", 1);
  const unchanged = reviewedCase("바나나", "doc_compare_banana", "b", 2);
  const cases = [recovered, unchanged];
  const bundle = createSearchEvaluationBundle({
    bundleId: "researcher.discovery",
    projectId: recovered.projectId,
    roleId: "researcher",
    taskType: "source-discovery",
    minimumActiveCases,
    activeCaseIds: cases.map((item) => item.caseId),
  });
  const coverage = createSearchEvaluationCoverage(bundle, cases);
  const corpus: SearchSourceInput[] = [
    { kind: "document", sourceId: "doc_compare_apple", contentHash: CURRENT_HASH, labels: [], text: "배" },
    { kind: "document", sourceId: "doc_compare_banana", contentHash: CURRENT_HASH, labels: [], text: "바나나" },
  ];
  const baselineIndex = new LexicalSearchIndex(corpus);
  const evaluatedAt = new Date("2026-08-20T03:00:00.000Z");
  const baseline = await executeSearchEvaluation({ index: baselineIndex, cases, evaluatedAt });
  const candidate = await executeSearchEvaluation({
    index: candidateIndex(corpus, "사과", "doc_compare_apple"),
    cases,
    evaluatedAt,
  });
  return { bundle, coverage, cases, corpus, baseline, candidate };
}

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
});
