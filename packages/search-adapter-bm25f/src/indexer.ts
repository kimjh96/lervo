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

export const BM25F_SEARCH_ENGINE = { id: "bm25f", version: 1 } as const;
// 실행 동작이나 runtime 의존성이 달라지면 새 비교 전에 반드시 올립니다.
const BM25F_ADAPTER_IMPLEMENTATION_REVISION = 1;
export const BM25F_ADAPTER_BUILD_ID = contentId("sebuild", {
  package: "@lervo/search-adapter-bm25f",
  implementationRevision: BM25F_ADAPTER_IMPLEMENTATION_REVISION,
  engine: BM25F_SEARCH_ENGINE,
  scoring: "bm25f-fixed-v1",
});

type FieldName = SearchHit["matchedFields"][number];

interface IndexedField {
  name: FieldName;
  normalized: string;
  frequencies: ReadonlyMap<string, number>;
  weight: number;
}

interface IndexedSource {
  input: SearchSourceInput;
  fields: IndexedField[];
  length: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function field(name: FieldName, value: string, weight: number): IndexedField | null {
  if (value.length === 0) return null;
  const normalized = normalizeSearchText(value);
  const frequencies = new Map<string, number>();
  for (const term of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  return { name, normalized, frequencies, weight };
}

function weightedFrequency(source: IndexedSource, term: string): number {
  return source.fields.reduce((sum, item) => sum + (item.frequencies.get(term) ?? 0) * item.weight, 0);
}

function inverseDocumentFrequency(total: number, matching: number): number {
  return Math.max(1, Math.floor((total + 1) * 1_000_000 / (matching + 1)));
}

function resultSetHash(hits: readonly SearchHit[]): string {
  return canonicalHash(hits.map((hit) => ({
    sourceKind: hit.source.kind,
    sourceId: hit.source.sourceId,
    contentHash: hit.source.contentHash,
    rank: hit.rank,
    score: hit.score,
  })));
}

export class Bm25fSearchIndex implements SearchEvaluationIndexPort {
  readonly engine = BM25F_SEARCH_ENGINE;
  readonly indexId: string;
  readonly corpusDigest: string;
  private readonly sources: IndexedSource[];
  private readonly averageLength: number;

  constructor(inputs: readonly SearchSourceInput[]) {
    const corpus = prepareSearchCorpus(inputs);
    this.sources = corpus.sources.map((input) => {
      const fields = [
        field("title", input.title ?? "", 12),
        field("path", input.path ?? "", 8),
        ...input.labels.map((label) => field("label", label, 10)),
        field("text", input.text, 2),
      ].filter((item): item is IndexedField => item !== null);
      const length = fields.reduce((sum, item) =>
        sum + [...item.frequencies.values()].reduce((fieldSum, count) => fieldSum + count, 0), 0);
      return { input, fields, length };
    });
    const totalLength = this.sources.reduce((sum, source) => sum + source.length, 0);
    this.averageLength = Math.max(1, Math.floor(totalLength / Math.max(1, this.sources.length)));
    this.corpusDigest = corpus.corpusDigest;
    this.indexId = contentId("sidx", {
      engine: BM25F_SEARCH_ENGINE,
      corpusDigest: corpus.corpusDigest,
      scoring: "bm25f-fixed-v1",
    });
  }

  search(query: string, limit = 10): SearchResponse {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_MAX_RESULTS) {
      throw new SearchError("invalid_query", `검색 결과 한도는 1 이상 ${SEARCH_MAX_RESULTS} 이하여야 합니다.`);
    }
    const terms = [...new Set(searchTerms(query, "invalid_query"))];
    const phrase = normalizeSearchText(query);
    const documentFrequencies = new Map(terms.map((term) => [
      term,
      this.sources.filter((source) => weightedFrequency(source, term) > 0).length,
    ]));
    const scored = this.sources.map((source) => {
      let score = 0;
      for (const term of terms) {
        const frequency = weightedFrequency(source, term);
        if (frequency === 0) continue;
        const lengthNormalization = 8 + Math.floor(4 * source.length / this.averageLength);
        const saturation = Math.floor(frequency * 2_000 / (frequency + lengthNormalization));
        score += Math.floor(
          inverseDocumentFrequency(this.sources.length, documentFrequencies.get(term)!) * saturation / 1_000,
        );
      }
      const matchedFields = [...new Set(source.fields.filter((item) =>
        item.normalized.includes(phrase) || terms.some((term) => item.frequencies.has(term)))
        .map((item) => item.name))].sort() as SearchHit["matchedFields"];
      return { source, score, matchedFields };
    }).filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score ||
        compareText(searchSourceKey(left.source.input), searchSourceKey(right.source.input)))
      .slice(0, limit);
    const hits: SearchHit[] = scored.map((item, index) => ({
      source: {
        kind: item.source.input.kind,
        sourceId: item.source.input.sourceId,
        contentHash: item.source.input.contentHash,
        ...(item.source.input.path === undefined ? {} : { path: item.source.input.path }),
      },
      rank: index + 1,
      score: item.score,
      matchedFields: item.matchedFields,
    }));
    return {
      schemaVersion: 1,
      engine: BM25F_SEARCH_ENGINE,
      indexId: this.indexId,
      ...identifySearchQuery(query),
      requestedLimit: limit,
      hits,
      resultSetHash: resultSetHash(hits),
    };
  }
}

export const bm25fSearchEvaluationEngine: SearchEvaluationEnginePort = {
  engine: BM25F_SEARCH_ENGINE,
  adapterBuildId: BM25F_ADAPTER_BUILD_ID,
  buildIndex: (sources) => new Bm25fSearchIndex(sources),
};
