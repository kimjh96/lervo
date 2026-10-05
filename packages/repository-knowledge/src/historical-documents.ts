import type { DecisionTaxonomy } from "@lervo/project";

/**
 * Recognized historical-document markers (ADR-0462):
 *
 * - `archive_scope`: the path is `docs/archive/**` or under a capacity override whose role is
 *   `archive` in `.lervo/knowledge/document-layout.yaml`.
 * - `front_matter`: leading YAML front matter declares `status:` or `lifecycle:` as `historical`,
 *   `archived`, or `superseded`, or declares `historical: true` or `archived: true`.
 * - `banner`: one of the first three non-empty body lines is a blockquote whose text, after
 *   emphasis markers, starts with `Historical`, `Archived`, or `Superseded` followed by `.`, `:`,
 *   `(`, `-`, or the end of the line.
 */
export type HistoricalDocumentMarker = "archive_scope" | "front_matter" | "banner";

export const defaultArchiveScope = "docs/archive";

const historicalValue = /^["']?(?:historical|archived|superseded)["']?$/iu;
const historicalFlag = /^(?:historical|archived)\s*:\s*["']?true["']?\s*$/iu;
const lifecycleField = /^(?:status|lifecycle)\s*:\s*(.+?)\s*$/iu;
const bannerText = /^(?:historical|archived|superseded)(?:[.:(\-—]|\s*$|\s+[(\-—])/iu;

export function archiveScopes(taxonomy: DecisionTaxonomy | null): string[] {
  const configured =
    taxonomy?.documentPolicy.capacity.overrides
      .filter((override) => override.role === "archive")
      .map((override) => override.scopePath) ?? [];
  return [...new Set([defaultArchiveScope, ...configured])].sort();
}

function frontMatterLines(content: string): { lines: string[]; bodyOffset: number } {
  const lines = content.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return { lines: [], bodyOffset: 0 };
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
  if (end < 0 || end > 64) return { lines: [], bodyOffset: 0 };
  return { lines: lines.slice(1, end), bodyOffset: end + 1 };
}

export function historicalDocumentMarker(input: {
  path: string;
  content: string | undefined;
  archiveScopes: readonly string[];
}): HistoricalDocumentMarker | null {
  if (input.archiveScopes.some((scope) => input.path.startsWith(`${scope}/`)))
    return "archive_scope";
  if (input.content === undefined) return null;
  const { lines, bodyOffset } = frontMatterLines(input.content);
  for (const line of lines) {
    if (historicalFlag.test(line.trim())) return "front_matter";
    const value = lifecycleField.exec(line.trim())?.[1];
    if (value !== undefined && historicalValue.test(value)) return "front_matter";
  }
  const body = input.content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .slice(bodyOffset)
    .filter((line) => line.trim() !== "")
    .slice(0, 3);
  for (const line of body) {
    const quoted = /^\s{0,3}>\s?(.*)$/u.exec(line)?.[1];
    if (quoted === undefined) continue;
    const text = quoted.replace(/^[*_\s]+/u, "");
    if (bannerText.test(text)) return "banner";
  }
  return null;
}

const historyQueryTerms = new Set([
  "archive",
  "archived",
  "historical",
  "history",
  "legacy",
  "superseded",
  "obsolete",
  "deprecated",
]);

/** A query targets history when it names one of the fixed history terms as a whole word. */
export function queryTargetsHistory(query: string): boolean {
  return (
    query
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).some((term) => historyQueryTerms.has(term));
}
