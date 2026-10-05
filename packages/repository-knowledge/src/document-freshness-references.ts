import { extractDocumentReferences, type DocumentReference } from "./document-references.js";
import type { DocumentFreshnessReference } from "./document-freshness-contract.js";

/** Read-only view of the current tree; the caller owns the filesystem or snapshot behind it. */
export interface DocumentFreshnessTreeOracle {
  exists(path: string): boolean;
  /** UTF-8 text of a current file, or null when absent, not a file, or above the read bound. */
  readText(path: string): string | null;
  /** True when the repository root contains this first path segment. */
  topLevel(segment: string): boolean;
}

/** A line that explicitly records history may keep a reference to a removed path. */
const historicalLine =
  /\b(?:historical|historically|archived|superseded|formerly|previously|removed|deleted|legacy)\b/iu;

export function isHistoricalReferenceLine(line: string): boolean {
  return historicalLine.test(line);
}

function symbolPresent(text: string, symbol: string): boolean {
  const name = symbol.split(".").at(-1)!;
  const escaped = name.replace(/[$]/gu, "\\$");
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, "u").test(text);
}

/**
 * The same resolution rule ADR-0464 lint applies: a weak path counts only when its first segment
 * exists, and a `path: Symbol` span also needs the symbol as a whole identifier in the file.
 */
export function documentReferenceResolved(
  reference: Pick<DocumentReference, "kind" | "target" | "symbol" | "weak">,
  oracle: DocumentFreshnessTreeOracle,
): boolean {
  if (reference.weak === true && !oracle.topLevel(reference.target.split("/")[0]!)) return true;
  if (!oracle.exists(reference.target)) return false;
  if (reference.kind !== "code_symbol" || reference.symbol === undefined) return true;
  const text = oracle.readText(reference.target);
  return text === null || symbolPresent(text, reference.symbol);
}

/** Outgoing references of one document with their current resolution. */
export function documentFreshnessReferences(input: {
  path: string;
  content: string;
  oracle: DocumentFreshnessTreeOracle;
}): DocumentFreshnessReference[] {
  return extractDocumentReferences(input).map((reference) => ({
    line: reference.line,
    target: reference.target,
    kind: reference.kind === "markdown_link" ? "link" : "path_mention",
    symbol: reference.symbol ?? null,
    resolved: documentReferenceResolved(reference, input.oracle),
  }));
}

/**
 * References in `content` that do not resolve and do not sit on a historical line. Used by the
 * `references_resolve` check, so an edit can never introduce or keep an unresolved reference.
 */
export function unresolvedDocumentReferences(input: {
  path: string;
  content: string;
  oracle: DocumentFreshnessTreeOracle;
}): DocumentReference[] {
  const lines = input.content.split(/\r?\n/u);
  return extractDocumentReferences(input).filter(
    (reference) =>
      !documentReferenceResolved(reference, input.oracle) &&
      !isHistoricalReferenceLine(lines[reference.line - 1] ?? ""),
  );
}
