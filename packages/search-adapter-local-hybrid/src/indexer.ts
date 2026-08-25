import { createHash } from "node:crypto";

import {
  canonicalHash,
  contentId,
  identifySearchQuery,
  LexicalSearchIndex,
  normalizeSearchText,
  prepareSearchCorpus,
  searchSourceKey,
  searchTerms,
  SEARCH_MAX_RESULTS,
  SearchError,
  type SearchEvaluationEnginePort,
  type SearchEvaluationIndexPort,
  type SearchHit,
  type SearchResponse,
  type SearchSourceInput,
} from "@lervo/search";

export const LOCAL_HYBRID_SEARCH_ENGINE = { id: "local-hybrid", version: 1 } as const;
const IMPLEMENTATION_REVISION = 1;
const EMBEDDING_DIMENSIONS = 4_096;
const BRANCH_DEPTH = SEARCH_MAX_RESULTS;

export const LOCAL_HYBRID_ADAPTER_BUILD_ID = contentId("sebuild", {
  package: "@lervo/search-adapter-local-hybrid",
  implementationRevision: IMPLEMENTATION_REVISION,
  engine: LOCAL_HYBRID_SEARCH_ENGINE,
  lexical: "lexical-v1",
  embedding: "feature-hash-nfkc-trigram-v1",
  fusion: "rank-sum-v1",
});

type FieldName = SearchHit["matchedFields"][number];
type Vector = ReadonlyMap<number, number>;

interface EmbeddedField {
  name: FieldName;
  vector: Vector;
}

interface EmbeddedSource {
  input: SearchSourceInput;
  fields: EmbeddedField[];
}

function featureIndex(feature: string): number {
  return createHash("sha256").update(feature).digest().readUInt32BE(0) % EMBEDDING_DIMENSIONS;
}

function features(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = [...tokens.map((token) => `word:${token}`)];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    result.push(`bigram:${tokens[index]}\u0000${tokens[index + 1]}`);
  }
  for (const token of tokens) {
    const characters = [...token];
    if (characters.length < 3) result.push(`short:${token}`);
    for (let index = 0; index + 2 < characters.length; index += 1) {
      result.push(`trigram:${characters.slice(index, index + 3).join("")}`);
    }
  }
  return result;
}

function embed(value: string, weight = 1): Vector {
  const vector = new Map<number, number>();
  for (const feature of features(value)) {
    const index = featureIndex(feature);
    vector.set(index, (vector.get(index) ?? 0) + weight);
  }
  return vector;
}

function dot(left: Vector, right: Vector): number {
  let score = 0;
  for (const [index, value] of left) score += value * (right.get(index) ?? 0);
  return score;
}

function responseHash(hits: readonly SearchHit[]): string {
  return canonicalHash(
    hits.map((hit) => ({
      sourceKind: hit.source.kind,
      sourceId: hit.source.sourceId,
      contentHash: hit.source.contentHash,
      rank: hit.rank,
      score: hit.score,
    })),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class LocalHybridSearchIndex implements SearchEvaluationIndexPort {
  readonly engine = LOCAL_HYBRID_SEARCH_ENGINE;
  readonly indexId: string;
  readonly corpusDigest: string;
  private readonly lexical: LexicalSearchIndex;
  private readonly sources: EmbeddedSource[];

  constructor(inputs: readonly SearchSourceInput[]) {
    const corpus = prepareSearchCorpus(inputs);
    this.corpusDigest = corpus.corpusDigest;
    this.lexical = new LexicalSearchIndex(corpus.sources);
    this.sources = corpus.sources.map((input) => ({
      input,
      fields: [
        input.title === undefined
          ? null
          : { name: "title" as const, vector: embed(input.title, 12) },
        input.path === undefined ? null : { name: "path" as const, vector: embed(input.path, 8) },
        ...input.labels.map((label) => ({ name: "label" as const, vector: embed(label, 10) })),
        { name: "text" as const, vector: embed(input.text, 2) },
      ].filter((field): field is EmbeddedField => field !== null),
    }));
    this.indexId = contentId("sidx", {
      engine: LOCAL_HYBRID_SEARCH_ENGINE,
      corpusDigest: corpus.corpusDigest,
      embedding: {
        algorithm: "feature-hash-nfkc-trigram-v1",
        dimensions: EMBEDDING_DIMENSIONS,
      },
      fusion: "rank-sum-v1",
    });
  }

  search(query: string, limit = 10): SearchResponse {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_MAX_RESULTS) {
      throw new SearchError(
        "invalid_query",
        `The search result limit must be between 1 and ${SEARCH_MAX_RESULTS}.`,
      );
    }
    searchTerms(query, "invalid_query");
    const queryVector = embed(query);
    const lexicalHits = this.lexical.search(query, BRANCH_DEPTH).hits;
    const vectorHits = this.sources
      .map((source) => {
        const fieldScores = source.fields.map((field) => ({
          name: field.name,
          score: dot(queryVector, field.vector),
        }));
        return {
          source,
          score: fieldScores.reduce((sum, field) => sum + field.score, 0),
          matchedFields: fieldScores
            .filter((field) => field.score > 0)
            .map((field) => field.name)
            .filter((field, index, values) => values.indexOf(field) === index)
            .sort(),
        };
      })
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(searchSourceKey(left.source.input), searchSourceKey(right.source.input)),
      )
      .slice(0, BRANCH_DEPTH);
    const fused = new Map<
      string,
      { input: SearchSourceInput; score: number; matchedFields: Set<FieldName> }
    >();
    for (const [rank, hit] of lexicalHits.entries()) {
      const key = searchSourceKey(hit.source);
      fused.set(key, {
        input: this.sources.find((source) => searchSourceKey(source.input) === key)!.input,
        score: BRANCH_DEPTH + 1 - rank - 1,
        matchedFields: new Set(hit.matchedFields),
      });
    }
    for (const [rank, hit] of vectorHits.entries()) {
      const key = searchSourceKey(hit.source.input);
      const current = fused.get(key) ?? {
        input: hit.source.input,
        score: 0,
        matchedFields: new Set<FieldName>(),
      };
      current.score += BRANCH_DEPTH + 1 - rank - 1;
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
      engine: LOCAL_HYBRID_SEARCH_ENGINE,
      indexId: this.indexId,
      ...identifySearchQuery(query),
      requestedLimit: limit,
      hits,
      resultSetHash: responseHash(hits),
    };
  }
}

export const localHybridSearchEvaluationEngine: SearchEvaluationEnginePort = {
  engine: LOCAL_HYBRID_SEARCH_ENGINE,
  adapterBuildId: LOCAL_HYBRID_ADAPTER_BUILD_ID,
  buildIndex: (sources) => new LocalHybridSearchIndex(sources),
};
