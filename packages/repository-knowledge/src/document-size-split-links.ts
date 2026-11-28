// ADR-0653: links across a document size split. A part moves into the document's directory, so its
// relative links are rebased; a link to a heading follows the heading into the part that now holds
// it; a reference definition travels with each part that uses it. Every rewrite is recorded, so the
// check can undo it and compare the written bytes with the original range.
import { posix } from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";

/** One link destination the split rewrote, at character offsets of the text before rewriting. */
export interface SplitLinkRewrite {
  start: number;
  end: number;
  before: string;
  after: string;
}

/** Where a heading of a split document now lives: its file and its anchor in that file. */
export interface SplitAnchorTarget {
  file: string;
  anchor: string;
}

/** For each split document, where each of its heading anchors now lives. */
export type SplitAnchorFiles = ReadonlyMap<string, ReadonlyMap<string, SplitAnchorTarget>>;

interface MarkdownNode {
  type?: string;
  url?: string;
  identifier?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: MarkdownNode[];
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/)/iu;

function decoded(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** Where `fragment` of a document now lives, matched as written, then case-insensitively. */
function anchorFile(
  anchors: ReadonlyMap<string, SplitAnchorTarget> | undefined,
  fragment: string,
): SplitAnchorTarget | undefined {
  if (anchors === undefined || fragment.length === 0) return undefined;
  const value = decoded(fragment);
  return anchors.get(value) ?? anchors.get(value.toLowerCase());
}

/** The destination `url` needs once its text moves from `fromPath` to `toPath`, or null. */
function rewrittenUrl(
  url: string,
  fromPath: string,
  toPath: string,
  anchorFiles: SplitAnchorFiles,
): string | null {
  if (url.length === 0 || EXTERNAL.test(url)) return null;
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/u.exec(url);
  const pathPart = match?.[1] ?? "";
  const query = match?.[2] ?? "";
  const fragment = (match?.[3] ?? "").slice(1);
  const target =
    pathPart.length === 0
      ? fromPath
      : posix.normalize(posix.join(posix.dirname(fromPath), pathPart));
  const holder = anchorFile(anchorFiles.get(target), fragment);
  if (holder !== undefined) {
    const file = holder.file === toPath ? "" : posix.relative(posix.dirname(toPath), holder.file);
    // A repeated heading's anchor is numbered within its new file, so it may change.
    const anchor = decoded(fragment) === holder.anchor ? fragment : holder.anchor;
    return `${file}${query}#${anchor}`;
  }
  if (pathPart.length === 0 || posix.dirname(fromPath) === posix.dirname(toPath)) return null;
  let rebased = posix.relative(posix.dirname(toPath), target);
  if (!rebased.startsWith(".") && pathPart.startsWith("./")) rebased = `./${rebased}`;
  return `${rebased}${query}${match?.[3] ?? ""}`;
}

/**
 * Rewrites the link and image destinations and the definitions of `text`, written to `toPath`
 * from a document at `fromPath`. A destination whose characters cannot be located is left as is
 * and returned in `unkept`, never dropped silently.
 */
export function rewriteSplitLinks(input: {
  text: string;
  fromPath: string;
  toPath: string;
  anchorFiles: SplitAnchorFiles;
}): { content: string; rewrites: SplitLinkRewrite[]; unkept: string[] } {
  const rewrites: SplitLinkRewrite[] = [];
  const unkept: string[] = [];
  const visit = (node: MarkdownNode): void => {
    if (
      (node.type === "link" || node.type === "image" || node.type === "definition") &&
      typeof node.url === "string"
    ) {
      const after = rewrittenUrl(node.url, input.fromPath, input.toPath, input.anchorFiles);
      if (after !== null && after !== node.url) {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        const slice =
          Number.isSafeInteger(start) && Number.isSafeInteger(end)
            ? input.text.slice(start, end)
            : "";
        const marker = slice.indexOf(node.type === "definition" ? "]:" : "](");
        const local = marker < 0 ? -1 : slice.indexOf(node.url, marker + 2);
        if (local < 0) unkept.push(node.url);
        else
          rewrites.push({
            start: start! + local,
            end: start! + local + node.url.length,
            before: node.url,
            after,
          });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(input.text) as MarkdownNode);
  rewrites.sort((left, right) => left.start - right.start);
  let content = "";
  let at = 0;
  for (const rewrite of rewrites) {
    content += input.text.slice(at, rewrite.start) + rewrite.after;
    at = rewrite.end;
  }
  return { content: content + input.text.slice(at), rewrites, unkept };
}

/** `written` with every recorded rewrite undone, or null when a rewrite is not where recorded. */
export function restoreSplitLinks(
  written: string,
  rewrites: readonly SplitLinkRewrite[],
): string | null {
  let restored = "";
  let at = 0;
  let original = 0;
  for (const rewrite of [...rewrites].sort((left, right) => left.start - right.start)) {
    const unchanged = rewrite.start - original;
    if (unchanged < 0) return null;
    restored += written.slice(at, at + unchanged);
    at += unchanged;
    if (!written.startsWith(rewrite.after, at)) return null;
    restored += rewrite.before;
    at += rewrite.after.length;
    original = rewrite.end;
  }
  return restored + written.slice(at);
}

/** Every reference definition of a document, by identifier, as its original text. */
export function documentReferenceDefinitions(documentContent: string): Map<string, string> {
  const definitions = new Map<string, string>();
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (
      node.type === "definition" &&
      typeof node.identifier === "string" &&
      !definitions.has(node.identifier) &&
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end)
    )
      definitions.set(node.identifier, documentContent.slice(start, end));
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(documentContent) as MarkdownNode);
  return definitions;
}

/**
 * The definitions `text` uses but does not hold, copied from its document's `definitions`, so
 * every reference in a part still resolves. A reference without its definition parses as plain
 * text, so uses are found by their brackets; copying a definition a part does not use is harmless.
 * Empty when the part needs none.
 */
export function missingReferenceDefinitions(
  text: string,
  definitions: ReadonlyMap<string, string>,
): string {
  if (definitions.size === 0) return "";
  const held = new Set<string>();
  const visit = (node: MarkdownNode): void => {
    if (node.type === "definition" && typeof node.identifier === "string")
      held.add(node.identifier);
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(text) as MarkdownNode);
  const lower = text.toLowerCase();
  const copied = [...definitions].flatMap(([identifier, definition]) => {
    if (held.has(identifier)) return [];
    const label = identifier.toLowerCase();
    const used =
      lower.includes(`][${label}]`) ||
      lower.includes(`[${label}][]`) ||
      new RegExp(`\\[${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\](?!\\s*[(:\\[])`, "u").test(
        lower,
      );
    return used ? [definition] : [];
  });
  return copied.length === 0 ? "" : `\n${copied.join("\n")}\n`;
}
