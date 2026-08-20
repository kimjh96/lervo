import { canonicalHash, contentId, sha256 } from "./integrity.js";
import { normalizeSearchText, searchTerms } from "./normalize.js";
import {
  SEARCH_ENGINE,
  SEARCH_MAX_RESULTS,
  SearchError,
  type SearchHit,
  type SearchResponse,
  type SearchSourceInput,
} from "./types.js";
import { assertSourceReference, assertText } from "./validation.js";

const MAX_SOURCES = 4096;
const MAX_TOTAL_CHARACTERS = 16 * 1024 * 1024;

type FieldName = SearchHit["matchedFields"][number];
interface IndexedField { name: FieldName; normalized: string; termFrequency: ReadonlyMap<string, number>; weight: number }
interface IndexedSource { input: SearchSourceInput; fields: IndexedField[] }

function sourceKey(source: SearchSourceInput): string {
  return `${source.kind.length}:${source.kind}${source.sourceId}`;
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
    else if (indexed.normalized.includes(queryTerm)) score += Math.max(1, Math.floor(indexed.weight / 2));
  }
  return score;
}

export class LexicalSearchIndex {
  readonly indexId: string;
  private readonly sources: IndexedSource[];

  constructor(inputs: readonly SearchSourceInput[]) {
    if (!Array.isArray(inputs) || inputs.length > MAX_SOURCES) {
      throw new SearchError("corpus_limit_exceeded", "검색 source 수가 안전한 한도를 넘었습니다.");
    }
    const seen = new Set<string>();
    let characters = 0;
    this.sources = inputs.map((input) => {
      assertSourceReference(input);
      if (typeof input.text !== "string" || input.text.length < 1 || input.text.length > 131_072 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) {
        throw new SearchError("corpus_invalid", "검색 source 본문 계약이 유효하지 않습니다.");
      }
      if (!Array.isArray(input.labels)) {
        throw new SearchError("corpus_invalid", "검색 source label 계약이 유효하지 않습니다.");
      }
      const labels = input.labels as readonly unknown[];
      if (labels.length > 32 || labels.some((label: unknown) => {
        if (typeof label !== "string") return true;
        try {
          assertText(label, 200, "corpus_invalid");
          return false;
        } catch {
          return true;
        }
      })) {
        throw new SearchError("corpus_invalid", "검색 source label 계약이 유효하지 않습니다.");
      }
      const validLabels = labels as readonly string[];
      if (input.title !== undefined) assertText(input.title, 500, "corpus_invalid");
      const key = sourceKey(input);
      if (seen.has(key)) throw new SearchError("corpus_invalid", "검색 source 종류와 ID 좌표가 중복되었습니다.");
      seen.add(key);
      characters += input.text.length + (input.title?.length ?? 0) + validLabels.join("").length;
      if (characters > MAX_TOTAL_CHARACTERS) {
        throw new SearchError("corpus_limit_exceeded", "검색 corpus 전체 크기가 안전한 한도를 넘었습니다.");
      }
      const fields = [
        field("title", input.title ?? "", 12),
        field("path", input.path ?? "", 8),
        ...validLabels.map((label) => field("label", label, 10)),
        field("text", input.text, 2),
      ].filter((item): item is IndexedField => item !== null);
      return { input: structuredClone(input), fields };
    }).sort((left, right) => compareText(sourceKey(left.input), sourceKey(right.input)));
    this.indexId = contentId("sidx", {
      engine: SEARCH_ENGINE,
      sources: this.sources.map(({ input }) => ({
        kind: input.kind,
        sourceId: input.sourceId,
        contentHash: input.contentHash,
        ...(input.path === undefined ? {} : { path: input.path }),
        searchProjectionHash: canonicalHash({
          title: input.title ?? null,
          labels: [...input.labels].sort(),
          text: input.text,
        }),
      })),
    });
  }

  search(query: string, limit = 10): SearchResponse {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_MAX_RESULTS) {
      throw new SearchError("invalid_query", `검색 결과 한도는 1 이상 ${SEARCH_MAX_RESULTS} 이하여야 합니다.`);
    }
    const terms = [...new Set(searchTerms(query, "invalid_query"))];
    const phrase = normalizeSearchText(query);
    const scored = this.sources.map(({ input, fields }) => {
      const fieldScores = fields.map((item) => ({ item, score: scoreField(item, terms, phrase) }));
      const score = fieldScores.reduce((sum, item) => sum + item.score, 0);
      const matchedFields = [...new Set(fieldScores.filter((item) => item.score > 0).map((item) => item.item.name))]
        .sort() as SearchHit["matchedFields"];
      return { input, score, matchedFields };
    }).filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || compareText(sourceKey(left.input), sourceKey(right.input)))
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
      queryDigest: sha256(phrase),
      queryCharacterCount: [...query].length,
      queryTermCount: terms.length,
      requestedLimit: limit,
      hits,
      resultSetHash: canonicalHash(resultCore),
    };
  }
}
