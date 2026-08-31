import {
  canonicalHash,
  contentId,
  identifySearchQuery,
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

import {
  analyzeLexicalV2Field,
  lexicalV2IdentifierTerms,
  lexicalV2Trigrams,
  type LexicalV2IndexedField,
} from "./features.js";
export const LEXICAL_V2_SEARCH_ENGINE = { id: "lexical", version: 2 } as const;
const LEXICAL_V2_ADAPTER_IMPLEMENTATION_REVISION = 6;
const RRF_RANK_CONSTANT = 60;
const RRF_SCORE_SCALE = 1_000_000;
const RRF_WINDOW = 100;
const MINIMUM_FUZZY_SIMILARITY_BASIS_POINTS = 6_000;
const MAXIMUM_FUZZY_ALIASES_PER_TERM = 8;

export const LEXICAL_V2_ADAPTER_BUILD_ID = contentId("sebuild", {
  package: "@lervo/search-adapter-lexical-v2",
  implementationRevision: LEXICAL_V2_ADAPTER_IMPLEMENTATION_REVISION,
  engine: LEXICAL_V2_SEARCH_ENGINE,
  scoring: "bm25f-identifier-component-trigram-rrf-v3",
});

interface IndexedSource {
  input: SearchSourceInput;
  fields: LexicalV2IndexedField[];
  length: number;
}

interface RankedSource {
  sourceIndex: number;
  score: number;
}

interface WeightedBranch {
  ranks: RankedSource[];
  weight: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function weightedFrequency(
  source: IndexedSource,
  term: string,
  projection: "exactFrequencies" | "identifierFrequencies",
): number {
  return source.fields.reduce(
    (sum, item) => sum + (item[projection].get(term) ?? 0) * item.weight,
    0,
  );
}

function inverseDocumentFrequency(total: number, matching: number): number {
  return Math.max(1, Math.floor(((total + 1) * 1_000_000) / (matching + 1)));
}

function resultSetHash(hits: readonly SearchHit[]): string {
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

export class LexicalV2SearchIndex implements SearchEvaluationIndexPort {
  readonly engine = LEXICAL_V2_SEARCH_ENGINE;
  readonly indexId: string;
  readonly corpusDigest: string;
  private readonly sources: IndexedSource[];
  private readonly averageLength: number;
  private readonly exactPostings = new Map<string, ReadonlyMap<number, number>>();
  private readonly identifierPostings = new Map<string, ReadonlyMap<number, number>>();
  private readonly vocabularyGrams = new Map<string, ReadonlySet<string>>();
  private readonly termGramCounts = new Map<string, number>();

  constructor(inputs: readonly SearchSourceInput[]) {
    const corpus = prepareSearchCorpus(inputs);
    const vocabulary = new Set<string>();
    this.sources = corpus.sources.map((input) => {
      const fields = [
        analyzeLexicalV2Field("title", input.title ?? "", 12),
        analyzeLexicalV2Field("path", input.path ?? "", 8),
        ...input.labels.map((label) => analyzeLexicalV2Field("label", label, 10)),
        analyzeLexicalV2Field("text", input.text, 2),
      ].filter((item): item is LexicalV2IndexedField => item !== null);
      let length = 0;
      for (const item of fields) {
        for (const [term, count] of item.exactFrequencies) {
          if (item.name !== "text") vocabulary.add(term);
          length += count;
        }
      }
      return { input, fields, length };
    });
    this.averageLength = Math.max(
      1,
      Math.floor(
        this.sources.reduce((sum, source) => sum + source.length, 0) /
          Math.max(1, this.sources.length),
      ),
    );
    const mutableExactPostings = new Map<string, Map<number, number>>();
    const mutableIdentifierPostings = new Map<string, Map<number, number>>();
    const addPostings = (
      target: Map<string, Map<number, number>>,
      sourceIndex: number,
      frequencies: ReadonlyMap<string, number>,
      weight: number,
    ): void => {
      for (const [term, count] of frequencies) {
        const postings = target.get(term) ?? new Map<number, number>();
        postings.set(sourceIndex, (postings.get(sourceIndex) ?? 0) + count * weight);
        target.set(term, postings);
      }
    };
    this.sources.forEach((source, sourceIndex) => {
      for (const item of source.fields) {
        addPostings(mutableExactPostings, sourceIndex, item.exactFrequencies, item.weight);
        addPostings(
          mutableIdentifierPostings,
          sourceIndex,
          item.identifierFrequencies,
          item.weight,
        );
      }
    });
    for (const [term, postings] of mutableExactPostings) this.exactPostings.set(term, postings);
    for (const [term, postings] of mutableIdentifierPostings) {
      this.identifierPostings.set(term, postings);
    }
    const mutableGrams = new Map<string, Set<string>>();
    for (const term of [...vocabulary].sort()) {
      const grams = lexicalV2Trigrams(term);
      if (grams.length === 0) continue;
      this.termGramCounts.set(term, grams.length);
      for (const gram of grams) {
        const terms = mutableGrams.get(gram) ?? new Set<string>();
        terms.add(term);
        mutableGrams.set(gram, terms);
      }
    }
    for (const [gram, terms] of mutableGrams) this.vocabularyGrams.set(gram, terms);
    this.corpusDigest = corpus.corpusDigest;
    this.indexId = contentId("sidx", {
      engine: LEXICAL_V2_SEARCH_ENGINE,
      corpusDigest: corpus.corpusDigest,
      scoring: "bm25f-identifier-component-trigram-rrf-v3",
    });
  }

  private rankTerms(
    terms: readonly string[],
    projection: "exactFrequencies" | "identifierFrequencies",
  ): RankedSource[] {
    if (terms.length === 0) return [];
    const index = projection === "exactFrequencies" ? this.exactPostings : this.identifierPostings;
    const scores = new Map<number, number>();
    for (const term of terms) {
      const postings = index.get(term);
      if (postings === undefined) continue;
      const documentFrequency = postings.size;
      for (const [sourceIndex, frequency] of postings) {
        const source = this.sources[sourceIndex]!;
        const lengthNormalization = 8 + Math.floor((4 * source.length) / this.averageLength);
        const saturation = Math.floor((frequency * 2_000) / (frequency + lengthNormalization));
        const contribution = Math.floor(
          (inverseDocumentFrequency(this.sources.length, documentFrequency) * saturation) / 1_000,
        );
        scores.set(sourceIndex, (scores.get(sourceIndex) ?? 0) + contribution);
      }
    }
    return [...scores]
      .map(([sourceIndex, score]) => ({ sourceIndex, score }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(
            searchSourceKey(this.sources[left.sourceIndex]!.input),
            searchSourceKey(this.sources[right.sourceIndex]!.input),
          ),
      )
      .slice(0, RRF_WINDOW);
  }

  private rankLegacy(terms: readonly string[], phrase: string): RankedSource[] {
    const candidates = new Set<number>();
    for (const term of terms) {
      for (const sourceIndex of this.exactPostings.get(term)?.keys() ?? []) {
        candidates.add(sourceIndex);
      }
    }
    return [...candidates]
      .map((sourceIndex) => {
        const source = this.sources[sourceIndex]!;
        const score = source.fields.reduce((sourceScore, item) => {
          let fieldScore = item.normalized.includes(phrase) ? item.weight * 2 : 0;
          for (const term of terms) {
            const exactCount = item.exactFrequencies.get(term) ?? 0;
            if (exactCount > 0) fieldScore += item.weight * exactCount;
            else if (item.normalized.includes(term)) {
              fieldScore += Math.max(1, Math.floor(item.weight / 2));
            }
          }
          return sourceScore + fieldScore;
        }, 0);
        return { sourceIndex, score };
      })
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(
            searchSourceKey(this.sources[left.sourceIndex]!.input),
            searchSourceKey(this.sources[right.sourceIndex]!.input),
          ),
      )
      .slice(0, RRF_WINDOW);
  }

  private fuzzyAliases(queryTerms: readonly string[]): Map<string, number> {
    const aliases = new Map<string, number>();
    for (const queryTerm of queryTerms) {
      const queryGrams = lexicalV2Trigrams(queryTerm);
      if (queryGrams.length === 0) continue;
      const overlaps = new Map<string, number>();
      for (const gram of queryGrams) {
        for (const term of this.vocabularyGrams.get(gram) ?? []) {
          overlaps.set(term, (overlaps.get(term) ?? 0) + 1);
        }
      }
      const ranked = [...overlaps]
        .map(([term, overlap]) => ({
          term,
          similarity: Math.floor(
            (2 * overlap * 10_000) / (queryGrams.length + this.termGramCounts.get(term)!),
          ),
        }))
        .filter(
          (item) =>
            item.similarity >= MINIMUM_FUZZY_SIMILARITY_BASIS_POINTS && item.term !== queryTerm,
        )
        .sort(
          (left, right) => right.similarity - left.similarity || compareText(left.term, right.term),
        )
        .slice(0, MAXIMUM_FUZZY_ALIASES_PER_TERM);
      for (const item of ranked) {
        aliases.set(item.term, Math.max(aliases.get(item.term) ?? 0, item.similarity));
      }
    }
    return aliases;
  }

  private rankFuzzy(aliases: ReadonlyMap<string, number>): RankedSource[] {
    if (aliases.size === 0) return [];
    const terms = [...aliases.keys()];
    return this.rankTerms(terms, "exactFrequencies").map((item) => ({
      ...item,
      score: Math.max(
        1,
        Math.floor(
          (item.score *
            Math.max(
              ...terms.map((term) =>
                weightedFrequency(this.sources[item.sourceIndex]!, term, "exactFrequencies") > 0
                  ? aliases.get(term)!
                  : 0,
              ),
            )) /
            10_000,
        ),
      ),
    }));
  }

  search(query: string, limit = 10): SearchResponse {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_MAX_RESULTS) {
      throw new SearchError(
        "invalid_query",
        `The search result limit must be between 1 and ${SEARCH_MAX_RESULTS}.`,
      );
    }
    const exactTerms = [...new Set(searchTerms(query, "invalid_query"))];
    const exactTermSet = new Set(exactTerms);
    const unmatchedTerms = exactTerms.filter((term) => !this.exactPostings.has(term));
    const expandedTerms = [
      ...new Set([...unmatchedTerms, ...lexicalV2IdentifierTerms(query, exactTermSet)]),
    ].filter((term) => [...term].length > 1);
    const aliases = this.fuzzyAliases(unmatchedTerms);
    const branches: WeightedBranch[] = [
      { ranks: this.rankLegacy(exactTerms, normalizeSearchText(query)), weight: 3 },
      { ranks: this.rankTerms(exactTerms, "exactFrequencies"), weight: 1 },
      { ranks: this.rankTerms(expandedTerms, "exactFrequencies"), weight: 1 },
      { ranks: this.rankTerms(expandedTerms, "identifierFrequencies"), weight: 1 },
      { ranks: this.rankFuzzy(aliases), weight: 1 },
    ].filter((branch) => branch.ranks.length > 0);
    const fused = new Map<number, number>();
    for (const branch of branches) {
      branch.ranks.forEach((item, index) => {
        const contribution = Math.floor(
          (branch.weight * RRF_SCORE_SCALE) / (RRF_RANK_CONSTANT + index + 1),
        );
        fused.set(item.sourceIndex, (fused.get(item.sourceIndex) ?? 0) + contribution);
      });
    }
    const scored = [...fused]
      .map(([sourceIndex, score]) => ({ sourceIndex, score }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(
            searchSourceKey(this.sources[left.sourceIndex]!.input),
            searchSourceKey(this.sources[right.sourceIndex]!.input),
          ),
      )
      .slice(0, limit);
    const matchedTerms = [...aliases.keys(), ...exactTerms, ...expandedTerms];
    const hits: SearchHit[] = scored.map((item, index) => {
      const source = this.sources[item.sourceIndex]!;
      const matchedFields = [
        ...new Set(
          source.fields
            .filter((candidate) =>
              matchedTerms.some(
                (term) =>
                  candidate.exactFrequencies.has(term) || candidate.identifierFrequencies.has(term),
              ),
            )
            .map((candidate) => candidate.name),
        ),
      ].sort() as SearchHit["matchedFields"];
      return {
        source: {
          kind: source.input.kind,
          sourceId: source.input.sourceId,
          contentHash: source.input.contentHash,
          ...(source.input.path === undefined ? {} : { path: source.input.path }),
        },
        rank: index + 1,
        score: item.score,
        matchedFields,
      };
    });
    return {
      schemaVersion: 1,
      engine: LEXICAL_V2_SEARCH_ENGINE,
      indexId: this.indexId,
      ...identifySearchQuery(query),
      requestedLimit: limit,
      hits,
      resultSetHash: resultSetHash(hits),
    };
  }
}

export const lexicalV2SearchEvaluationEngine: SearchEvaluationEnginePort = {
  engine: LEXICAL_V2_SEARCH_ENGINE,
  adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
  buildIndex: (sources) => new LexicalV2SearchIndex(sources),
};
