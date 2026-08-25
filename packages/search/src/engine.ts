import { prepareSearchCorpus, searchSourceKey } from "./corpus.js";
import { canonicalHash, contentId } from "./integrity.js";
import { identifySearchQuery, normalizeSearchText, searchTerms } from "./normalize.js";
import {
  SEARCH_ENGINE,
  SEARCH_MAX_RESULTS,
  SearchError,
  type SearchHit,
  type SearchResponse,
  type SearchSourceInput,
} from "./types.js";

type FieldName = SearchHit["matchedFields"][number];
interface IndexedField {
  name: FieldName;
  normalized: string;
  termFrequency: ReadonlyMap<string, number>;
  weight: number;
}
interface IndexedSource {
  input: SearchSourceInput;
  fields: IndexedField[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function field(name: FieldName, value: string, weight: number): IndexedField | null {
  if (value.length === 0) return null;
  const normalized = normalizeSearchText(value);
  const termFrequency = new Map<string, number>();
  for (const term of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  }
  return { name, normalized, termFrequency, weight };
}

function scoreField(indexed: IndexedField, queryTerms: readonly string[], phrase: string): number {
  let score = indexed.normalized.includes(phrase) ? indexed.weight * 2 : 0;
  for (const queryTerm of queryTerms) {
    const exactCount = indexed.termFrequency.get(queryTerm) ?? 0;
    if (exactCount > 0) score += indexed.weight * exactCount;
    else if (indexed.normalized.includes(queryTerm))
      score += Math.max(1, Math.floor(indexed.weight / 2));
  }
  return score;
}

export class LexicalSearchIndex {
  readonly engine = SEARCH_ENGINE;
  readonly corpusDigest: string;
  readonly indexId: string;
  private readonly sources: IndexedSource[];

  constructor(inputs: readonly SearchSourceInput[]) {
    const corpus = prepareSearchCorpus(inputs);
    this.sources = corpus.sources.map((input) => {
      const fields = [
        field("title", input.title ?? "", 12),
        field("path", input.path ?? "", 8),
        ...input.labels.map((label) => field("label", label, 10)),
        field("text", input.text, 2),
      ].filter((item): item is IndexedField => item !== null);
      return { input, fields };
    });
    this.corpusDigest = corpus.corpusDigest;
    this.indexId = contentId("sidx", { engine: SEARCH_ENGINE, sources: corpus.indexSources });
  }

  search(query: string, limit = 10): SearchResponse {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_MAX_RESULTS) {
      throw new SearchError(
        "invalid_query",
        `The search result limit must be between 1 and ${SEARCH_MAX_RESULTS}.`,
      );
    }
    const terms = [...new Set(searchTerms(query, "invalid_query"))];
    const queryIdentity = identifySearchQuery(query);
    const phrase = normalizeSearchText(query);
    const scored = this.sources
      .map(({ input, fields }) => {
        const fieldScores = fields.map((item) => ({
          item,
          score: scoreField(item, terms, phrase),
        }));
        const score = fieldScores.reduce((sum, item) => sum + item.score, 0);
        const matchedFields = [
          ...new Set(fieldScores.filter((item) => item.score > 0).map((item) => item.item.name)),
        ].sort() as SearchHit["matchedFields"];
        return { input, score, matchedFields };
      })
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(searchSourceKey(left.input), searchSourceKey(right.input)),
      )
      .slice(0, limit);
    const hits: SearchHit[] = scored.map((item, index) => ({
      source: {
        kind: item.input.kind,
        sourceId: item.input.sourceId,
        contentHash: item.input.contentHash,
        ...(item.input.path === undefined ? {} : { path: item.input.path }),
      },
      rank: index + 1,
      score: item.score,
      matchedFields: item.matchedFields,
    }));
    const resultCore = hits.map((hit) => ({
      sourceKind: hit.source.kind,
      sourceId: hit.source.sourceId,
      contentHash: hit.source.contentHash,
      rank: hit.rank,
      score: hit.score,
    }));
    return {
      schemaVersion: 1,
      engine: SEARCH_ENGINE,
      indexId: this.indexId,
      ...queryIdentity,
      requestedLimit: limit,
      hits,
      resultSetHash: canonicalHash(resultCore),
    };
  }
}
