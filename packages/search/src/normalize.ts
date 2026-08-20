import { SearchError } from "./types.js";
import { sha256 } from "./integrity.js";
import { assertText } from "./validation.js";

const TERM_PATTERN = /[\p{L}\p{N}]+/gu;
const MAX_QUERY_TERMS = 32;

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/gu, " ").trim();
}

export function searchTerms(value: string, code: "corpus_invalid" | "invalid_query"): string[] {
  const maximum = code === "invalid_query" ? 500 : 131_072;
  const normalized = normalizeSearchText(assertText(value, maximum, code));
  const terms = normalized.match(TERM_PATTERN) ?? [];
  if (terms.length === 0 || (code === "invalid_query" && terms.length > MAX_QUERY_TERMS)) {
    throw new SearchError(code, "검색어를 1개 이상 32개 이하의 문자·숫자 단위로 입력해야 합니다.");
  }
  return terms;
}

export function identifySearchQuery(query: string): {
  queryDigest: string;
  queryCharacterCount: number;
  queryTermCount: number;
} {
  const terms = [...new Set(searchTerms(query, "invalid_query"))];
  return {
    queryDigest: sha256(normalizeSearchText(query)),
    queryCharacterCount: [...query].length,
    queryTermCount: terms.length,
  };
}
