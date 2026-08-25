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
const IMPLEMENTATION_REVISION = 2;
const EMBEDDING_DIMENSIONS = 4_096;
const BRANCH_DEPTH = SEARCH_MAX_RESULTS;

export const LOCAL_HYBRID_ADAPTER_BUILD_ID = contentId("sebuild", {
  package: "@lervo/search-adapter-local-hybrid",
  implementationRevision: IMPLEMENTATION_REVISION,
  engine: LOCAL_HYBRID_SEARCH_ENGINE,
  lexical: "lexical-v1",
  embedding: "feature-hash-codepoint-fnv1a-nfkc-trigram-v2",
  fusion: "lexical-weighted-rank-sum-v2",
});

type FieldName = SearchHit["matchedFields"][number];
type Vector = ReadonlyMap<number, number>;

interface VectorPosting {
  sourceIndex: number;
  name: FieldName;
  value: number;
}

function featureIndex(feature: string): number {
  let hash = 2_166_136_261;
  for (const character of feature) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619);
  }
  return (hash >>> 0) % EMBEDDING_DIMENSIONS;
}

function features(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
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

function embed(value: string, weight = 1, cache?: Map<string, number>): Vector {
  const vector = new Map<number, number>();
  for (const feature of features(value)) {
    let index = cache?.get(feature);
    if (index === undefined) {
      index = featureIndex(feature);
      cache?.set(feature, index);
    }
    vector.set(index, (vector.get(index) ?? 0) + weight);
  }
  return vector;
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
  private readonly sources: SearchSourceInput[];
  private readonly sourceByKey: ReadonlyMap<string, SearchSourceInput>;
  private readonly postings: ReadonlyMap<number, readonly VectorPosting[]>;

  constructor(inputs: readonly SearchSourceInput[]) {
    const corpus = prepareSearchCorpus(inputs);
    this.corpusDigest = corpus.corpusDigest;
    this.lexical = new LexicalSearchIndex(corpus.sources);
    this.sources = corpus.sources;
    this.sourceByKey = new Map(corpus.sources.map((input) => [searchSourceKey(input), input]));
    const featureCache = new Map<string, number>();
    const postings = new Map<number, VectorPosting[]>();
    for (const [sourceIndex, input] of corpus.sources.entries()) {
      const fields: Array<{ name: FieldName; value: string; weight: number }> = [
        ...(input.title === undefined
          ? []
          : [{ name: "title" as const, value: input.title, weight: 12 }]),
        ...(input.path === undefined
          ? []
          : [{ name: "path" as const, value: input.path, weight: 8 }]),
        ...input.labels.map((value) => ({ name: "label" as const, value, weight: 10 })),
        { name: "text" as const, value: input.text, weight: 2 },
      ];
      for (const field of fields) {
        for (const [dimension, value] of embed(field.value, field.weight, featureCache)) {
          const values = postings.get(dimension) ?? [];
          values.push({ sourceIndex, name: field.name, value });
          postings.set(dimension, values);
        }
      }
    }
    this.postings = postings;
    this.indexId = contentId("sidx", {
      engine: LOCAL_HYBRID_SEARCH_ENGINE,
      corpusDigest: corpus.corpusDigest,
      embedding: {
        algorithm: "feature-hash-codepoint-fnv1a-nfkc-trigram-v2",
        dimensions: EMBEDDING_DIMENSIONS,
      },
      fusion: "lexical-weighted-rank-sum-v2",
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
    const vectorScores = new Map<number, { score: number; matchedFields: Set<FieldName> }>();
    for (const [dimension, queryValue] of queryVector) {
      for (const posting of this.postings.get(dimension) ?? []) {
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
        input: this.sources[sourceIndex]!,
        score: observation.score,
        matchedFields: [...observation.matchedFields].sort(),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(searchSourceKey(left.input), searchSourceKey(right.input)),
      )
      .slice(0, BRANCH_DEPTH);
    const fused = new Map<
      string,
      { input: SearchSourceInput; score: number; matchedFields: Set<FieldName> }
    >();
    for (const [rank, hit] of lexicalHits.entries()) {
      const key = searchSourceKey(hit.source);
      fused.set(key, {
        input: this.sourceByKey.get(key)!,
        score: (BRANCH_DEPTH - rank) * 2,
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
      current.score += BRANCH_DEPTH - rank;
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
