import {
  canonicalHash,
  contentId,
  identifySearchQuery,
  LexicalSearchIndex,
  normalizeSearchText,
  prepareReusableSearchCorpus,
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
const IMPLEMENTATION_REVISION = 3;
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

interface CachedToken {
  id: number;
  value: string;
  wordDimension: number;
  shortDimension: number | null;
  bigramPrefixHash: number;
  trigrams: number[];
  bigrams: Map<number, number>;
}

interface FeatureHashCache {
  tokens: Map<string, CachedToken>;
  trigrams: Map<string, number>;
  featureDimensions: Uint16Array;
  nextFeatureId: number;
  nextTokenId: number;
  generation: number;
  seenFeatures: Uint32Array;
  seenTokens: Uint32Array;
  tokenBuffer: CachedToken[];
  uniqueTokenBuffer: CachedToken[];
}

interface MutablePostingBucket {
  sourceIndexes: number[];
  values: number[];
  fieldMasks: number[];
}

const FIELD_MASK = {
  label: 1 << 0,
  path: 1 << 1,
  text: 1 << 2,
  title: 1 << 3,
} satisfies Record<FieldName, number>;

function updateFeatureHash(hash: number, value: string): number {
  let current = hash;
  for (const character of value) {
    current = Math.imul(current ^ character.codePointAt(0)!, 16_777_619);
  }
  return current;
}

const FEATURE_HASH_OFFSET = 2_166_136_261;
const WORD_PREFIX_HASH = updateFeatureHash(FEATURE_HASH_OFFSET, "word:");
const BIGRAM_PREFIX_HASH = updateFeatureHash(FEATURE_HASH_OFFSET, "bigram:");
const SHORT_PREFIX_HASH = updateFeatureHash(FEATURE_HASH_OFFSET, "short:");
const TRIGRAM_PREFIX_HASH = updateFeatureHash(FEATURE_HASH_OFFSET, "trigram:");

function featureIndex(hash: number, parts: readonly string[]): number {
  for (const part of parts) hash = updateFeatureHash(hash, part);
  return (hash >>> 0) % EMBEDDING_DIMENSIONS;
}

function createFeatureHashCache(): FeatureHashCache {
  return {
    tokens: new Map(),
    trigrams: new Map(),
    featureDimensions: new Uint16Array(131_072),
    nextFeatureId: 0,
    nextTokenId: 0,
    generation: 0,
    seenFeatures: new Uint32Array(131_072),
    seenTokens: new Uint32Array(8_192),
    tokenBuffer: [],
    uniqueTokenBuffer: [],
  };
}

function grow(values: Uint16Array | Uint32Array, minimumLength: number) {
  if (values.length > minimumLength) return values;
  const nextLength = Math.max(minimumLength + 1, values.length * 2);
  const next =
    values instanceof Uint16Array ? new Uint16Array(nextLength) : new Uint32Array(nextLength);
  next.set(values);
  return next;
}

function ensureFeatureCapacity(cache: FeatureHashCache, featureId: number): void {
  cache.featureDimensions = grow(cache.featureDimensions, featureId) as Uint16Array;
  cache.seenFeatures = grow(cache.seenFeatures, featureId) as Uint32Array;
}

function ensureTokenCapacity(cache: FeatureHashCache, tokenId: number): void {
  cache.seenTokens = grow(cache.seenTokens, tokenId) as Uint32Array;
}

function cachedToken(cache: FeatureHashCache, value: string): CachedToken {
  const cached = cache.tokens.get(value);
  if (cached !== undefined) return cached;
  const characters = [...value];
  const trigrams: number[] = [];
  for (let index = 0; index + 2 < characters.length; index += 1) {
    const fragment = characters.slice(index, index + 3).join("");
    let featureId = cache.trigrams.get(fragment);
    if (featureId === undefined) {
      featureId = cache.nextFeatureId;
      ensureFeatureCapacity(cache, featureId);
      cache.featureDimensions[featureId] = featureIndex(TRIGRAM_PREFIX_HASH, [fragment]);
      cache.nextFeatureId += 1;
      cache.trigrams.set(fragment, featureId);
    }
    trigrams.push(featureId);
  }
  const token: CachedToken = {
    id: cache.nextTokenId,
    value,
    wordDimension: featureIndex(WORD_PREFIX_HASH, [value]),
    shortDimension: characters.length < 3 ? featureIndex(SHORT_PREFIX_HASH, [value]) : null,
    bigramPrefixHash: updateFeatureHash(updateFeatureHash(BIGRAM_PREFIX_HASH, value), "\u0000"),
    trigrams,
    bigrams: new Map(),
  };
  ensureTokenCapacity(cache, token.id);
  cache.nextTokenId += 1;
  cache.tokens.set(value, token);
  return token;
}

function cachedBigram(cache: FeatureHashCache, left: CachedToken, right: CachedToken): number {
  const cached = left.bigrams.get(right.id);
  if (cached !== undefined) return cached;
  const featureId = cache.nextFeatureId;
  ensureFeatureCapacity(cache, featureId);
  cache.featureDimensions[featureId] = featureIndex(left.bigramPrefixHash, [right.value]);
  cache.nextFeatureId += 1;
  left.bigrams.set(right.id, featureId);
  return featureId;
}

function forEachFeatureDimension(
  value: string,
  cache: FeatureHashCache | undefined,
  visit: (dimension: number) => void,
): void {
  const normalized = normalizeSearchText(value);
  const tokenValues = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  forEachTokenFeatureDimension(tokenValues, cache, visit);
}

function forEachTokenFeatureDimension(
  tokenValues: readonly string[],
  cache: FeatureHashCache | undefined,
  visit: (dimension: number) => void,
): void {
  const featureCache = cache ?? createFeatureHashCache();
  featureCache.generation += 1;
  const generation = featureCache.generation;
  const tokens = featureCache.tokenBuffer;
  const uniqueTokens = featureCache.uniqueTokenBuffer;
  tokens.length = 0;
  uniqueTokens.length = 0;
  for (const value of tokenValues) {
    const token = cachedToken(featureCache, value);
    tokens.push(token);
    if (featureCache.seenTokens[token.id] === generation) continue;
    featureCache.seenTokens[token.id] = generation;
    uniqueTokens.push(token);
    visit(token.wordDimension);
  }
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const left = tokens[index]!;
    const right = tokens[index + 1]!;
    const featureId = cachedBigram(featureCache, left, right);
    if (featureCache.seenFeatures[featureId] === generation) continue;
    featureCache.seenFeatures[featureId] = generation;
    visit(featureCache.featureDimensions[featureId]!);
  }
  for (const token of uniqueTokens) {
    if (token.shortDimension !== null) visit(token.shortDimension);
    for (const featureId of token.trigrams) {
      if (featureCache.seenFeatures[featureId] === generation) continue;
      featureCache.seenFeatures[featureId] = generation;
      visit(featureCache.featureDimensions[featureId]!);
    }
  }
}

function accumulateTokenFeatureDimensions(
  tokenValues: readonly string[],
  cache: FeatureHashCache,
  sourceGeneration: number,
  weight: number,
  fieldMask: number,
  dimensionGenerations: Uint32Array,
  dimensionValues: Float64Array,
  dimensionFieldMasks: Uint8Array,
  touchedDimensions: number[],
): void {
  cache.generation += 1;
  const fieldGeneration = cache.generation;
  const tokens = cache.tokenBuffer;
  const uniqueTokens = cache.uniqueTokenBuffer;
  tokens.length = 0;
  uniqueTokens.length = 0;
  const accumulate = (dimension: number): void => {
    if (dimensionGenerations[dimension] !== sourceGeneration) {
      dimensionGenerations[dimension] = sourceGeneration;
      dimensionValues[dimension] = weight;
      dimensionFieldMasks[dimension] = fieldMask;
      touchedDimensions.push(dimension);
      return;
    }
    dimensionValues[dimension] = dimensionValues[dimension]! + weight;
    dimensionFieldMasks[dimension] = dimensionFieldMasks[dimension]! | fieldMask;
  };
  for (const value of tokenValues) {
    const token = cachedToken(cache, value);
    tokens.push(token);
    if (cache.seenTokens[token.id] === fieldGeneration) continue;
    cache.seenTokens[token.id] = fieldGeneration;
    uniqueTokens.push(token);
    accumulate(token.wordDimension);
  }
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const featureId = cachedBigram(cache, tokens[index]!, tokens[index + 1]!);
    if (cache.seenFeatures[featureId] === fieldGeneration) continue;
    cache.seenFeatures[featureId] = fieldGeneration;
    accumulate(cache.featureDimensions[featureId]!);
  }
  for (const token of uniqueTokens) {
    if (token.shortDimension !== null) accumulate(token.shortDimension);
    for (const featureId of token.trigrams) {
      if (cache.seenFeatures[featureId] === fieldGeneration) continue;
      cache.seenFeatures[featureId] = fieldGeneration;
      accumulate(cache.featureDimensions[featureId]!);
    }
  }
}

function embed(value: string): Vector {
  const vector = new Map<number, number>();
  forEachFeatureDimension(value, undefined, (dimension) => {
    vector.set(dimension, (vector.get(dimension) ?? 0) + 1);
  });
  return vector;
}

function matchedFields(fieldMask: number): SearchHit["matchedFields"] {
  return (Object.keys(FIELD_MASK) as FieldName[]).filter(
    (field) => (fieldMask & FIELD_MASK[field]) !== 0,
  );
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
  private readonly sourceKeys: string[];
  private readonly sourceByKey: ReadonlyMap<string, SearchSourceInput>;
  private readonly postingOffsets: Uint32Array;
  private readonly postingSourceIndexes: Uint16Array;
  private readonly postingValues: Float64Array;
  private readonly postingFieldMasks: Uint8Array;

  constructor(inputs: readonly SearchSourceInput[]) {
    const corpus = prepareReusableSearchCorpus(inputs);
    this.corpusDigest = corpus.corpusDigest;
    this.sources = corpus.sources;
    this.sourceKeys = corpus.sources.map((input) => searchSourceKey(input));
    this.sourceByKey = new Map(corpus.sources.map((input) => [searchSourceKey(input), input]));
    const featureCache = createFeatureHashCache();
    const postingBuckets = new Array<MutablePostingBucket | undefined>(EMBEDDING_DIMENSIONS);
    const dimensionGenerations = new Uint32Array(EMBEDDING_DIMENSIONS);
    const dimensionValues = new Float64Array(EMBEDDING_DIMENSIONS);
    const dimensionFieldMasks = new Uint8Array(EMBEDDING_DIMENSIONS);
    const touchedDimensions: number[] = [];
    let activeSourceIndex = -1;
    const flushSource = (): void => {
      if (activeSourceIndex < 0) return;
      for (const dimension of touchedDimensions) {
        const bucket = postingBuckets[dimension] ?? {
          sourceIndexes: [],
          values: [],
          fieldMasks: [],
        };
        bucket.sourceIndexes.push(activeSourceIndex);
        bucket.values.push(dimensionValues[dimension]!);
        bucket.fieldMasks.push(dimensionFieldMasks[dimension]!);
        postingBuckets[dimension] = bucket;
      }
    };
    this.lexical = LexicalSearchIndex.fromPreparedCorpus(corpus, (field) => {
      if (field.sourceIndex !== activeSourceIndex) {
        flushSource();
        activeSourceIndex = field.sourceIndex;
        touchedDimensions.length = 0;
      }
      const generation = field.sourceIndex + 1;
      accumulateTokenFeatureDimensions(
        field.tokens,
        featureCache,
        generation,
        field.weight,
        FIELD_MASK[field.name],
        dimensionGenerations,
        dimensionValues,
        dimensionFieldMasks,
        touchedDimensions,
      );
    });
    flushSource();
    this.postingOffsets = new Uint32Array(EMBEDDING_DIMENSIONS + 1);
    let postingCount = 0;
    for (let dimension = 0; dimension < EMBEDDING_DIMENSIONS; dimension += 1) {
      this.postingOffsets[dimension] = postingCount;
      postingCount += postingBuckets[dimension]?.sourceIndexes.length ?? 0;
    }
    this.postingOffsets[EMBEDDING_DIMENSIONS] = postingCount;
    this.postingSourceIndexes = new Uint16Array(postingCount);
    this.postingValues = new Float64Array(postingCount);
    this.postingFieldMasks = new Uint8Array(postingCount);
    let postingIndex = 0;
    for (const bucket of postingBuckets) {
      if (bucket === undefined) continue;
      for (let index = 0; index < bucket.sourceIndexes.length; index += 1) {
        this.postingSourceIndexes[postingIndex] = bucket.sourceIndexes[index]!;
        this.postingValues[postingIndex] = bucket.values[index]!;
        this.postingFieldMasks[postingIndex] = bucket.fieldMasks[index]!;
        postingIndex += 1;
      }
    }
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
    const vectorScores = new Map<number, { score: number; fieldMask: number }>();
    for (const [dimension, queryValue] of queryVector) {
      const end = this.postingOffsets[dimension + 1]!;
      for (let index = this.postingOffsets[dimension]!; index < end; index += 1) {
        const sourceIndex = this.postingSourceIndexes[index]!;
        const current = vectorScores.get(sourceIndex) ?? {
          score: 0,
          fieldMask: 0,
        };
        current.score += queryValue * this.postingValues[index]!;
        current.fieldMask |= this.postingFieldMasks[index]!;
        vectorScores.set(sourceIndex, current);
      }
    }
    const vectorHits = [...vectorScores.entries()]
      .map(([sourceIndex, observation]) => ({
        sourceIndex,
        input: this.sources[sourceIndex]!,
        score: observation.score,
        matchedFields: matchedFields(observation.fieldMask),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(this.sourceKeys[left.sourceIndex]!, this.sourceKeys[right.sourceIndex]!),
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
