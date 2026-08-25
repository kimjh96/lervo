import {
  canonicalHash,
  contentId,
  createSearchAssessment,
  createSearchAttempt,
  createSearchEvaluationBundle,
  createSearchEvaluationCase,
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
export const CANDIDATE_ADAPTER_BUILD_ID = contentId("sebuild", {
  adapter: "fixture_candidate",
  revision: 1,
});

function reviewedCase(
  query: string,
  sourceId: string,
  nonce: string,
  minute: number,
): SearchEvaluationCase {
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
  const indexId = contentId("sidx", {
    engine: CANDIDATE_ENGINE,
    corpusDigest: lexical.corpusDigest,
  });
  return {
    engine: CANDIDATE_ENGINE,
    indexId,
    search(query, limit) {
      const lexicalResponse = lexical.search(query, limit);
      let hits = lexicalResponse.hits;
      if (query === recoveredQuery) {
        const source = corpus.find((item) => item.sourceId === recoveredSourceId)!;
        hits = [
          {
            source: {
              kind: source.kind,
              sourceId: source.sourceId,
              contentHash: source.contentHash,
            },
            rank: 1,
            score: 1,
            matchedFields: ["text"],
          } satisfies SearchHit,
        ];
      }
      return {
        ...lexicalResponse,
        engine: CANDIDATE_ENGINE,
        indexId,
        ...identifySearchQuery(query),
        hits,
        resultSetHash: canonicalHash(
          hits.map((hit) => ({
            sourceKind: hit.source.kind,
            sourceId: hit.source.sourceId,
            contentHash: hit.source.contentHash,
            rank: hit.rank,
            score: hit.score,
          })),
        ),
      };
    },
  };
}

export async function comparisonFixture(minimumActiveCases = 2, recoverCandidate = true) {
  const recovered = reviewedCase("apple", "doc_compare_apple", "a", 1);
  const unchanged = reviewedCase("banana", "doc_compare_banana", "b", 2);
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
    {
      kind: "document",
      sourceId: "doc_compare_apple",
      contentHash: CURRENT_HASH,
      labels: [],
      text: "pear",
    },
    {
      kind: "document",
      sourceId: "doc_compare_banana",
      contentHash: CURRENT_HASH,
      labels: [],
      text: "banana",
    },
  ];
  const evaluatedAt = new Date("2026-08-20T03:00:00.000Z");
  const baseline = await executeSearchEvaluation({
    index: new LexicalSearchIndex(corpus),
    cases,
    evaluatedAt,
  });
  const candidate = await executeSearchEvaluation({
    index: candidateIndex(
      corpus,
      recoverCandidate ? "apple" : "__no_recovery__",
      "doc_compare_apple",
    ),
    cases,
    evaluatedAt,
  });
  return {
    bundle,
    coverage,
    cases,
    corpus,
    baseline,
    candidate,
    candidateAdapterBuildId: CANDIDATE_ADAPTER_BUILD_ID,
  };
}
