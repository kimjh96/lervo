import { canonicalHash, identifySearchQuery, searchTerms } from "@lervo/search";

// Local vocabulary expansion is retrieval-only. It cannot create rules, actions, or permissions.
const aliases: ReadonlyArray<readonly [RegExp, string]> = [
  [/성능|속도|지연/gu, "performance latency"],
  [/검색|찾아|찾기/gu, "search retrieval"],
  [/캐시/gu, "cache"],
  [/문서/gu, "documentation"],
  [/설계/gu, "design architecture"],
  [/배포|릴리스/gu, "release deployment"],
  [/규칙|지침/gu, "instruction policy"],
  [/오류|버그|실패/gu, "error failure"],
  [/동시|경합/gu, "concurrency conflict"],
  [/취소/gu, "cancellation"],
  [/메모리/gu, "memory"],
  [/권한/gu, "authority permission"],
  [/복구/gu, "recovery"],
];
export const taskQueryProjectorBuild = canonicalHash({
  id: "lervo.task-query.local",
  version: 2,
  aliases: aliases.map(([pattern, expansion]) => [pattern.source, expansion]),
});

function packWords(
  text: string,
  maximumTerms: number,
  maximumCharacters: number,
): { text: string; terms: number } {
  const words: string[] = [];
  let terms = 0;
  let characters = 0;
  for (const word of text.trim().split(/\s+/u)) {
    if (!/[\p{L}\p{N}]/u.test(word.normalize("NFKC"))) continue;
    const count = searchTerms(word, "corpus_invalid").length;
    const addedCharacters = word.length + (words.length ? 1 : 0);
    if (terms + count > maximumTerms || characters + addedCharacters > maximumCharacters) continue;
    words.push(word);
    terms += count;
    characters += addedCharacters;
  }
  return { text: words.join(" "), terms };
}
export function projectTaskQuery(input: {
  intent: string;
  continuation?: string;
  targetPaths?: readonly string[];
  retrievalLanguages?: readonly string[];
}): { query: string; build: string; inputDigest: string; providerCalls: 0 } {
  if (Buffer.byteLength(JSON.stringify(input)) > 16384 || (input.targetPaths?.length ?? 0) > 64)
    throw new TypeError("Task query projection exceeds its input bound.");
  const intent = input.intent.trim().split(/\s+/u).slice(0, 32).join(" ");
  const continuation = input.continuation?.trim().replace(/\s+/gu, " ") ?? "";
  const context =
    intent.length < 32 && continuation
      ? `${intent} ${packWords(continuation, 32, 160).text}`
      : intent;
  const expansions =
    input.retrievalLanguages?.length && !input.retrievalLanguages.includes("en")
      ? []
      : aliases
          .filter(([pattern]) => new RegExp(pattern.source, "u").test(context))
          .map(([, expansion]) => expansion);
  // Count with the search engine's tokenizer: a path or hyphenated identifier is several terms.
  // Admit whole words so a byte/character budget cannot silently change an identifier.
  const targets = packWords((input.targetPaths ?? []).join(" "), 10, 100);
  const suffix = packWords([...new Set(expansions)].join(" "), 8, 78);
  const primary = packWords(context, 32 - targets.terms - suffix.terms, 320);
  const query = [primary.text, targets.text, suffix.text].filter(Boolean).join(" ");
  identifySearchQuery(query);
  return {
    query,
    build: taskQueryProjectorBuild,
    inputDigest: canonicalHash(input),
    providerCalls: 0,
  };
}
