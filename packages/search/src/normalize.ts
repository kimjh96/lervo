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
    throw new SearchError(code, "A query must contain between 1 and 32 letter-or-number terms.");
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
