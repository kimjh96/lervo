import { posix } from "node:path";

/**
 * Deterministic repository-path references inferred from one Markdown document (ADR-0464).
 *
 * - `markdown_link`: inline links, images, and reference definitions whose target is not a URL,
 *   scheme, protocol-relative, or anchor-only coordinate. The fragment and query are removed;
 *   targets resolve against the document directory, or the repository root when they start with
 *   `/`. Targets escaping the repository are dropped.
 * - `code_path`: an inline code span outside fenced blocks that is a repository-root-relative path
 *   with at least one `/`, no whitespace, glob, placeholder, or scheme characters, and either a
 *   file extension or a trailing `/`. Extension-less paths without a trailing `/` are `weak` and
 *   count only when their first segment exists at the repository root. A `:line[:column]` suffix
 *   is removed.
 * - `code_symbol`: an inline code span of the form `path: Symbol` with a strong `code_path` and an
 *   identifier symbol, optionally dotted.
 * - `fence_path`: a fenced-code info string naming a strong path directly or as `title=`,
 *   `file=`, or `path=`.
 */
export type DocumentReferenceKind = "markdown_link" | "code_path" | "code_symbol" | "fence_path";

export interface DocumentReference {
  kind: DocumentReferenceKind;
  target: string;
  /** One-based source line of the first occurrence. */
  line: number;
  symbol?: string;
  weak?: true;
}

export const MAXIMUM_DOCUMENT_REFERENCES = 512;

const schemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})(.*)$/u;
const inlineCodePattern = /(`+)([^`]+?)\1(?!`)/gu;
const inlineLinkPattern =
  /!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gu;
const referenceDefinitionPattern = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/u;
const pathCharacters = /^[A-Za-z0-9_.][A-Za-z0-9_./+@-]*$/u;
const symbolPattern = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u;
const extensionPattern = /\.[A-Za-z0-9]{1,10}$/u;

function normalizedRepositoryPath(value: string): string | null {
  const normalized = posix.normalize(value.replace(/^\.\//u, ""));
  if (
    normalized === "." ||
    normalized === "" ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  )
    return null;
  return normalized.replace(/\/$/u, "");
}

function linkTarget(documentPath: string, raw: string): string | null {
  let target = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  if (target === "" || target.startsWith("#") || target.startsWith("//")) return null;
  if (schemePattern.test(target)) return null;
  target = target.replace(/[?#].*$/u, "");
  if (target === "") return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  const joined = target.startsWith("/")
    ? target.slice(1)
    : posix.join(posix.dirname(documentPath), target);
  return normalizedRepositoryPath(joined);
}

function codePath(value: string): { target: string; weak: boolean } | null {
  const candidate = value.replace(/:\d+(?::\d+)?$/u, "");
  if (
    !candidate.includes("/") ||
    candidate.startsWith("/") ||
    candidate.startsWith("@") ||
    candidate.includes("..") ||
    candidate.includes("//") ||
    !pathCharacters.test(candidate)
  )
    return null;
  const directory = candidate.endsWith("/");
  const target = normalizedRepositoryPath(candidate);
  if (target === null) return null;
  const strong = directory || extensionPattern.test(target.split("/").at(-1) ?? "");
  return { target, weak: !strong };
}

function inlineCodeReference(content: string): Omit<DocumentReference, "line"> | null {
  const trimmed = content.trim();
  const symbolMatch = /^(\S+):\s?([^\s:]+)$/u.exec(trimmed);
  if (symbolMatch !== null && symbolPattern.test(symbolMatch[2]!)) {
    const path = codePath(symbolMatch[1]!);
    if (path !== null && !path.weak)
      return { kind: "code_symbol", target: path.target, symbol: symbolMatch[2]! };
  }
  const path = codePath(trimmed);
  if (path === null) return null;
  return { kind: "code_path", target: path.target, ...(path.weak ? { weak: true as const } : {}) };
}

function fenceReference(info: string): string | null {
  const tokens = info
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== "");
  for (const [index, token] of tokens.entries()) {
    const named = /^(?:title|file|path)=["']?([^"']+)["']?$/u.exec(token)?.[1];
    if (named === undefined && index === 0) continue;
    const path = codePath(named ?? token);
    if (path !== null && !path.weak) return path.target;
  }
  return null;
}

/**
 * Extracts bounded, deduplicated references in first-occurrence order; a target mentioned weakly
 * and later strongly is strong. `markdownLinksOnly` keeps code references from spending the bound,
 * so link checks see every link.
 */
export function extractDocumentReferences(input: {
  path: string;
  content: string;
  markdownLinksOnly?: boolean;
  /** Filters before the bound, so rejected references never displace accepted ones. */
  accept?: (reference: DocumentReference) => boolean;
}): DocumentReference[] {
  const references = new Map<string, DocumentReference>();
  const add = (reference: DocumentReference): void => {
    if (input.markdownLinksOnly && reference.kind !== "markdown_link") return;
    if (input.accept !== undefined && !input.accept(reference)) return;
    const key = `${reference.kind}\u0000${reference.target}\u0000${reference.symbol ?? ""}`;
    const existing = references.get(key);
    // A strong mention after a weak one of the same target keeps its place and becomes strong.
    if (existing !== undefined) {
      if (existing.weak === true && reference.weak !== true) references.set(key, reference);
      return;
    }
    if (references.size >= MAXIMUM_DOCUMENT_REFERENCES) return;
    references.set(key, reference);
  };
  let fence: string | null = null;
  const lines = input.content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    const fenceMatch = fencePattern.exec(line);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1]!.startsWith(fence) && fenceMatch[2]!.trim() === "")
        fence = null;
      continue;
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1]!;
      const target = fenceReference(fenceMatch[2]!);
      if (target !== null) add({ kind: "fence_path", target, line: lineNumber });
      continue;
    }
    const withoutCode = line.replace(inlineCodePattern, (_match, _ticks, code: string) => {
      const reference = inlineCodeReference(code);
      if (reference !== null) add({ ...reference, line: lineNumber });
      return " ";
    });
    const definition = referenceDefinitionPattern.exec(withoutCode)?.[1];
    if (definition !== undefined) {
      const target = linkTarget(input.path, definition);
      if (target !== null) add({ kind: "markdown_link", target, line: lineNumber });
    }
    for (const match of withoutCode.matchAll(inlineLinkPattern)) {
      const target = linkTarget(input.path, match[1]!);
      if (target !== null) add({ kind: "markdown_link", target, line: lineNumber });
    }
  }
  return [...references.values()];
}
