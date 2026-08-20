import { canonicalHash } from "./integrity.js";
import type { SearchSourceInput } from "./types.js";
import { SearchError } from "./types.js";
import { assertSourceReference, assertText } from "./validation.js";

export const SEARCH_MAX_SOURCES = 4096;
export const SEARCH_MAX_SOURCE_CHARACTERS = 131_072;
export const SEARCH_MAX_TOTAL_CHARACTERS = 16 * 1024 * 1024;

export interface PreparedSearchCorpus {
  sources: SearchSourceInput[];
  indexSources: Array<{
    kind: SearchSourceInput["kind"];
    sourceId: string;
    contentHash: string;
    path?: string;
    searchProjectionHash: string;
  }>;
  corpusDigest: string;
}

export function searchSourceKey(source: Pick<SearchSourceInput, "kind" | "sourceId">): string {
  return `${source.kind.length}:${source.kind}${source.sourceId}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function prepareSearchCorpus(inputs: readonly SearchSourceInput[]): PreparedSearchCorpus {
  if (!Array.isArray(inputs) || inputs.length > SEARCH_MAX_SOURCES) {
    throw new SearchError("corpus_limit_exceeded", "검색 source 수가 안전한 한도를 넘었습니다.");
  }
  const seen = new Set<string>();
  let characters = 0;
  const sources = inputs.map((input) => {
    assertSourceReference(input);
    if (typeof input.text !== "string" || input.text.length < 1 ||
      input.text.length > SEARCH_MAX_SOURCE_CHARACTERS ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) {
      throw new SearchError("corpus_invalid", "검색 source 본문 계약이 유효하지 않습니다.");
    }
    if (!Array.isArray(input.labels)) {
      throw new SearchError("corpus_invalid", "검색 source label 계약이 유효하지 않습니다.");
    }
    const labels = input.labels as readonly unknown[];
    if (labels.length > 32 || labels.some((label) => {
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
    if (input.title !== undefined) assertText(input.title, 500, "corpus_invalid");
    const key = searchSourceKey(input);
    if (seen.has(key)) throw new SearchError("corpus_invalid", "검색 source 종류와 ID 좌표가 중복되었습니다.");
    seen.add(key);
    characters += input.text.length + (input.title?.length ?? 0) + (labels as readonly string[]).join("").length;
    if (characters > SEARCH_MAX_TOTAL_CHARACTERS) {
      throw new SearchError("corpus_limit_exceeded", "검색 corpus 전체 크기가 안전한 한도를 넘었습니다.");
    }
    return structuredClone(input);
  }).sort((left, right) => compareText(searchSourceKey(left), searchSourceKey(right)));
  const indexSources = sources.map((source) => ({
    kind: source.kind,
    sourceId: source.sourceId,
    contentHash: source.contentHash,
    ...(source.path === undefined ? {} : { path: source.path }),
    searchProjectionHash: canonicalHash({
      title: source.title ?? null,
      labels: [...source.labels].sort(),
      text: source.text,
    }),
  }));
  return { sources, indexSources, corpusDigest: canonicalHash(indexSources) };
}
