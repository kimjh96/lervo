import {
  canonicalHash,
  contentId,
  createSearchAssessment,
  createSearchAttempt,
  createSearchEvaluationCase,
  executeSearchEvaluation,
  identifySearchQuery,
  LexicalSearchIndex,
  normalizeSearchText,
  prepareSearchCorpus,
  searchSourceKey,
  searchTerms,
  SEARCH_MAX_RESULTS,
  SearchError,
  verifySearchEvaluationEngineContract,
  type SearchHit,
  type SearchResponse,
  type SearchSourceInput,
} from "@lervo/search";
import { describe, expect, it } from "vitest";

import { LocalHybridSearchIndex, localHybridSearchEvaluationEngine } from "../src/index.js";

const sources: SearchSourceInput[] = [
  {
    kind: "document",
    sourceId: "doc_auth",
    contentHash: `sha256:${"1".repeat(64)}`,
    path: "docs/auth.md",
    title: "Identity",
    labels: ["security"],
    text: "The service authenticates every request.",
  },
  {
    kind: "document",
    sourceId: "doc_cache",
    contentHash: `sha256:${"2".repeat(64)}`,
    path: "docs/cache.md",
    title: "Cache",
    labels: ["runtime"],
    text: "Cached results expire deterministically.",
  },
];

type FieldName = SearchHit["matchedFields"][number];

function legacyFeatureIndex(feature: string): number {
  let hash = 2_166_136_261;
  for (const character of feature) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619);
  }
  return (hash >>> 0) % 4_096;
}

function legacyFeatures(value: string): string[] {
  const tokens = normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set<string>();
  const uniqueTokens = new Set<string>();
  for (const token of tokens) {
    result.add(`word:${token}`);
    uniqueTokens.add(token);
  }
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    result.add(`bigram:${tokens[index]}\u0000${tokens[index + 1]}`);
  }
  for (const token of uniqueTokens) {
    const characters = [...token];
    if (characters.length < 3) result.add(`short:${token}`);
    for (let index = 0; index + 2 < characters.length; index += 1) {
      result.add(`trigram:${characters.slice(index, index + 3).join("")}`);
    }
  }
  return [...result];
}

function legacyEmbed(value: string, weight = 1): Map<number, number> {
  const vector = new Map<number, number>();
  for (const feature of legacyFeatures(value)) {
    const dimension = legacyFeatureIndex(feature);
    vector.set(dimension, (vector.get(dimension) ?? 0) + weight);
  }
  return vector;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function legacyIndex(inputs: readonly SearchSourceInput[]) {
  const corpus = prepareSearchCorpus(inputs);
  const lexical = new LexicalSearchIndex(corpus.sources);
  const sourceByKey = new Map(corpus.sources.map((input) => [searchSourceKey(input), input]));
  const postings = new Map<
    number,
    Array<{ sourceIndex: number; name: FieldName; value: number }>
  >();
  for (const [sourceIndex, input] of corpus.sources.entries()) {
    const fields: Array<{ name: FieldName; value: string; weight: number }> = [
      ...(input.title === undefined
        ? []
        : [{ name: "title" as const, value: input.title, weight: 12 }]),
      ...(input.path === undefined
        ? []
        : [{ name: "path" as const, value: input.path, weight: 8 }]),
      ...input.labels.map((value) => ({ name: "label" as const, value, weight: 10 })),
      { name: "text", value: input.text, weight: 2 },
    ];
    for (const field of fields) {
      for (const [dimension, value] of legacyEmbed(field.value, field.weight)) {
        const bucket = postings.get(dimension) ?? [];
        bucket.push({ sourceIndex, name: field.name, value });
        postings.set(dimension, bucket);
      }
    }
  }
  const indexId = contentId("sidx", {
    engine: { id: "local-hybrid", version: 1 },
    corpusDigest: corpus.corpusDigest,
    embedding: {
      algorithm: "feature-hash-codepoint-fnv1a-nfkc-trigram-v2",
      dimensions: 4_096,
    },
    fusion: "lexical-weighted-rank-sum-v2",
  });
  return {
    search(query: string, limit = 10): SearchResponse {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_MAX_RESULTS) {
        throw new SearchError("invalid_query", "The search result limit is invalid.");
      }
      searchTerms(query, "invalid_query");
      const vectorScores = new Map<number, { score: number; matchedFields: Set<FieldName> }>();
      for (const [dimension, queryValue] of legacyEmbed(query)) {
        for (const posting of postings.get(dimension) ?? []) {
          const current = vectorScores.get(posting.sourceIndex) ?? {
            score: 0,
            matchedFields: new Set<FieldName>(),
          };
          current.score += queryValue * posting.value;
          current.matchedFields.add(posting.name);
          vectorScores.set(posting.sourceIndex, current);
        }
      }
      const vectorHits = [...vectorScores.entries()]
        .map(([sourceIndex, observation]) => ({
          input: corpus.sources[sourceIndex]!,
          score: observation.score,
          matchedFields: [...observation.matchedFields].sort(),
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            compareText(searchSourceKey(left.input), searchSourceKey(right.input)),
        )
        .slice(0, SEARCH_MAX_RESULTS);
      const fused = new Map<
        string,
        { input: SearchSourceInput; score: number; matchedFields: Set<FieldName> }
      >();
      for (const [rank, hit] of lexical.search(query, SEARCH_MAX_RESULTS).hits.entries()) {
        const key = searchSourceKey(hit.source);
        fused.set(key, {
          input: sourceByKey.get(key)!,
          score: (SEARCH_MAX_RESULTS - rank) * 2,
          matchedFields: new Set(hit.matchedFields),
        });
      }
      for (const [rank, hit] of vectorHits.entries()) {
        const key = searchSourceKey(hit.input);
        const current = fused.get(key) ?? {
          input: hit.input,
          score: 0,
          matchedFields: new Set<FieldName>(),
        };
        current.score += SEARCH_MAX_RESULTS - rank;
        for (const field of hit.matchedFields) current.matchedFields.add(field);
        fused.set(key, current);
      }
      const hits: SearchHit[] = [...fused.values()]
        .sort(
          (left, right) =>
            right.score - left.score ||
            compareText(searchSourceKey(left.input), searchSourceKey(right.input)),
        )
        .slice(0, limit)
        .map((item, index) => ({
          source: {
            kind: item.input.kind,
            sourceId: item.input.sourceId,
            contentHash: item.input.contentHash,
            ...(item.input.path === undefined ? {} : { path: item.input.path }),
          },
          rank: index + 1,
          score: item.score,
          matchedFields: [...item.matchedFields].sort(),
        }));
      return {
        schemaVersion: 1,
        engine: { id: "local-hybrid", version: 1 },
        indexId,
        ...identifySearchQuery(query),
        requestedLimit: limit,
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

function collidingTokens(): [string, string] {
  const dimensions = new Map<number, string>();
  for (let index = 0; index < 10_000; index += 1) {
    const token = `collision${index}`;
    const dimension = legacyFeatureIndex(`word:${token}`);
    const existing = dimensions.get(dimension);
    if (existing !== undefined) return [existing, token];
    dimensions.set(dimension, token);
  }
  throw new Error("The collision fixture could not be constructed.");
}

describe("deterministic local hybrid search", () => {
  it("passes the common engine contract with reversed corpus replay", async () => {
    const report = await verifySearchEvaluationEngineContract({
      engine: localHybridSearchEvaluationEngine,
      sources,
      queries: ["authentication", "runtime cache"],
    });
    expect(report.checkedQueries).toBe(2);
  });

  it("preserves every legacy response field across Unicode, collisions, duplicate labels, and replay", async () => {
    const [leftCollision, rightCollision] = collidingTokens();
    const richSources: SearchSourceInput[] = [
      ...sources,
      {
        kind: "document",
        sourceId: "doc_unicode_collision",
        contentHash: `sha256:${"3".repeat(64)}`,
        path: `docs/${leftCollision}.md`,
        title: `Ｃafé ${rightCollision}`,
        labels: ["evidence", "evidence"],
        text: `한글 정규화 ${leftCollision} authentication authenticates`,
      },
    ];
    const legacy = legacyIndex(richSources);
    const current = new LocalHybridSearchIndex(richSources);
    const reversed = new LocalHybridSearchIndex([...richSources].reverse());
    const queries = [
      `${leftCollision} ${rightCollision}`,
      "café evidence",
      "한글 정규화",
      "authentication",
    ];

    for (const query of queries) {
      const expected = legacy.search(query, 50);
      expect(current.search(query, 50)).toEqual(expected);
      expect(reversed.search(query, 50)).toEqual(expected);
      const [first, second] = await Promise.all([
        Promise.resolve().then(() => current.search(query, 50)),
        Promise.resolve().then(() => current.search(query, 50)),
      ]);
      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
    }
  });

  it("preserves the 4,096-source boundary and the maximum packed source index", () => {
    const boundarySources: SearchSourceInput[] = Array.from({ length: 4_096 }, (_, index) => ({
      kind: "document",
      sourceId: `doc_boundary_${String(index).padStart(4, "0")}`,
      contentHash: `sha256:${"4".repeat(64)}`,
      labels: [],
      text: "boundary",
    }));

    expect(new LocalHybridSearchIndex(boundarySources).search("boundary", 50)).toEqual(
      legacyIndex(boundarySources).search("boundary", 50),
    );
  });

  it("finds a morphology-adjacent document missed by exact keyword terms", () => {
    const response = new LocalHybridSearchIndex(sources).search("authentication", 10);
    expect(response.hits[0]).toMatchObject({
      source: { sourceId: "doc_auth" },
      rank: 1,
      score: expect.any(Number),
    });
    expect(response.hits[0]?.matchedFields).toContain("text");
  });

  it("beats the lexical baseline on the same reviewed top-10 case", async () => {
    const query = "authentication";
    const observedAt = new Date("2026-08-25T00:00:00Z");
    const referenceAttempt = createSearchAttempt({
      projectId: "prj_hybrid_compare_01",
      observedAt,
      nonce: "a".repeat(32),
      response: new LexicalSearchIndex(sources).search(query, 50),
    });
    const assessment = createSearchAssessment({
      attempt: referenceAttempt,
      assessedAt: new Date("2026-08-25T00:01:00Z"),
      assessor: "human",
      outcome: "failed",
      failureReason: "expected_source_missing",
      expectedSources: [{ sourceKind: "document", sourceId: "doc_auth" }],
    });
    const evaluationCase = createSearchEvaluationCase({
      attempt: referenceAttempt,
      assessment,
      query,
      maximumRank: 10,
    });
    const [baseline, candidate] = await Promise.all([
      executeSearchEvaluation({
        index: new LexicalSearchIndex(sources),
        cases: [evaluationCase],
        evaluatedAt: new Date("2026-08-25T00:02:00Z"),
      }),
      executeSearchEvaluation({
        index: new LocalHybridSearchIndex(sources),
        cases: [evaluationCase],
        evaluatedAt: new Date("2026-08-25T00:02:00Z"),
      }),
    ]);

    expect(baseline.results[0]?.status).toBe("failed");
    expect(candidate.results[0]?.status).toBe("passed");
    expect(evaluationCase.expectation.maximumRank).toBe(10);
  });
});
