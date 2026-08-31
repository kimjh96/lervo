import type { SearchHit } from "@lervo/search";

export type LexicalV2FieldName = SearchHit["matchedFields"][number];

export interface LexicalV2IndexedField {
  name: LexicalV2FieldName;
  normalized: string;
  exactFrequencies: ReadonlyMap<string, number>;
  identifierFrequencies: ReadonlyMap<string, number>;
  weight: number;
}

function frequencyMap(terms: readonly string[]): ReadonlyMap<string, number> {
  const frequencies = new Map<string, number>();
  for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  return frequencies;
}

const TERM_PATTERN = /[\p{L}\p{N}]+/gu;
const IDENTIFIER_BOUNDARY_PATTERN = /[\p{Ll}\p{N}]\p{Lu}|\p{Lu}\p{Lu}\p{Ll}|\p{L}\p{N}|\p{N}\p{L}/u;

function identifierTerms(canonical: string, excludedTerms: ReadonlySet<string>): string[] {
  const terms: string[] = [];
  for (const rawTerm of canonical.match(TERM_PATTERN) ?? []) {
    if (!IDENTIFIER_BOUNDARY_PATTERN.test(rawTerm)) continue;
    const separated = rawTerm
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/(\p{L})(\p{N})|(\p{N})(\p{L})/gu, "$1$3 $2$4")
      .toLowerCase();
    for (const term of separated.match(TERM_PATTERN) ?? []) {
      if (!excludedTerms.has(term)) terms.push(term);
    }
  }
  return terms;
}

export function lexicalV2IdentifierTerms(
  value: string,
  excludedTerms: ReadonlySet<string> = new Set(),
): string[] {
  return identifierTerms(value.normalize("NFKC"), excludedTerms);
}

export function analyzeLexicalV2Field(
  name: LexicalV2FieldName,
  value: string,
  weight: number,
): LexicalV2IndexedField | null {
  if (value.length === 0) return null;
  const canonical = value.normalize("NFKC");
  const normalized = canonical.toLocaleLowerCase("und").replace(/\s+/gu, " ").trim();
  const exactTerms = normalized.match(TERM_PATTERN) ?? [];
  const exactTermSet = new Set(exactTerms);
  return {
    name,
    normalized,
    exactFrequencies: frequencyMap(exactTerms),
    identifierFrequencies: frequencyMap(identifierTerms(canonical, exactTermSet)),
    weight,
  };
}

export function lexicalV2Trigrams(term: string): string[] {
  const characters = [...term];
  if (
    characters.length < 4 ||
    characters.length > 48 ||
    !/^[a-z0-9]+$/u.test(term) ||
    /^\p{N}+$/u.test(term)
  ) {
    return [];
  }
  const grams = new Set<string>();
  for (let index = 0; index <= characters.length - 3; index += 1) {
    grams.add(characters.slice(index, index + 3).join(""));
  }
  return [...grams].sort();
}
