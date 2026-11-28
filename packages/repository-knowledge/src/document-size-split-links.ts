// ADR-0653: links across a document size split. A part moves into the document's directory, so its
// relative links are rebased; a link to a heading follows the heading into the part that now holds
// it; a reference definition travels with each part that uses it. Destinations are located by the
// CommonMark parser, never by searching text, and every rewrite is recorded, so the check can
// undo it on exactly that destination and compare the written bytes with the original range.
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
  identifier?: string;
  label?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: MarkdownNode[];
}

interface Token {
  start: { offset: number };
  end: { offset: number };
}

/**
 * The character range of every link, image, and definition destination in `text`, as the parser
 * reads it, without the angle brackets of `<destination>`. Ranges never overlap, so a nested link
 * or a destination that contains another's text is rewritten exactly once, in its own place.
 */
export function markdownDestinations(text: string): Array<{ start: number; end: number }> {
  return parseWithDestinations(text).destinations;
}

function parseWithDestinations(text: string): {
  tree: MarkdownNode;
  destinations: Array<{ start: number; end: number }>;
} {
  const destinations: Array<{ start: number; end: number }> = [];
  const record = (token: Token) => {
    let start = token.start.offset;
    let end = token.end.offset;
    if (text[start] === "<" && text[end - 1] === ">") {
      start += 1;
      end -= 1;
    }
    if (end > start) destinations.push({ start, end });
  };
  const tree = fromMarkdown(text, {
    mdastExtensions: [{ exit: { resourceDestination: record, definitionDestination: record } }],
  }) as MarkdownNode;
  return { tree, destinations: destinations.sort((left, right) => left.start - right.start) };
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
  anchors: ReadonlyMap<string, SplitAnchorTarget>,
  fragment: string,
): SplitAnchorTarget | undefined {
  const value = decoded(fragment);
  return anchors.get(value) ?? anchors.get(value.toLowerCase());
}

/**
 * The destination `url` needs once its text moves from `fromPath` to `toPath`: unchanged, a new
 * destination, or `unkept` when it names a heading of a split document that no file holds.
 */
function rewrittenUrl(
  url: string,
  fromPath: string,
  toPath: string,
  anchorFiles: SplitAnchorFiles,
): string | "unkept" | null {
  if (url.length === 0 || EXTERNAL.test(url)) return null;
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/u.exec(url);
  const pathPart = match?.[1] ?? "";
  const query = match?.[2] ?? "";
  const fragment = (match?.[3] ?? "").slice(1);
  const target =
    pathPart.length === 0
      ? fromPath
      : posix.normalize(posix.join(posix.dirname(fromPath), decoded(pathPart)));
  const anchors = anchorFiles.get(target);
  if (anchors !== undefined && fragment.length > 0) {
    const holder = anchorFile(anchors, fragment);
    if (holder === undefined) return "unkept";
    const file = holder.file === toPath ? "" : posix.relative(posix.dirname(toPath), holder.file);
    // A repeated heading's anchor is numbered within its new file, so it may change.
    const anchor = decoded(fragment) === holder.anchor ? fragment : holder.anchor;
    return `${encodeURI(file)}${query}#${anchor}`;
  }
  if (pathPart.length === 0 || posix.dirname(fromPath) === posix.dirname(toPath)) return null;
  let rebased = encodeURI(posix.relative(posix.dirname(toPath), target));
  if (!rebased.startsWith(".") && pathPart.startsWith("./")) rebased = `./${rebased}`;
  return `${rebased}${query}${match?.[3] ?? ""}`;
}

/**
 * Rewrites the link, image, and definition destinations of `text`, written to `toPath` from a
 * document at `fromPath`. A destination naming a heading no file holds stays as is and is
 * returned in `unkept`, never dropped silently.
 */
export function rewriteSplitLinks(input: {
  text: string;
  fromPath: string;
  toPath: string;
  anchorFiles: SplitAnchorFiles;
  /** The destinations of `text`, when the caller read them already; otherwise they are parsed. */
  destinations?: ReadonlyArray<{ start: number; end: number }>;
}): { content: string; rewrites: SplitLinkRewrite[]; unkept: string[] } {
  const rewrites: SplitLinkRewrite[] = [];
  const unkept: string[] = [];
  for (const range of input.destinations ?? markdownDestinations(input.text)) {
    const before = input.text.slice(range.start, range.end);
    const after = rewrittenUrl(before, input.fromPath, input.toPath, input.anchorFiles);
    if (after === "unkept") unkept.push(before);
    else if (after !== null && after !== before) rewrites.push({ ...range, before, after });
  }
  let content = "";
  let at = 0;
  for (const rewrite of rewrites) {
    content += input.text.slice(at, rewrite.start) + rewrite.after;
    at = rewrite.end;
  }
  return { content: content + input.text.slice(at), rewrites, unkept };
}

/**
 * `written` with every recorded rewrite undone, or null when a rewrite is not where recorded or
 * does not lie exactly on a destination the parser reads in the restored text.
 */
export function restoreSplitLinks(
  written: string,
  rewrites: readonly SplitLinkRewrite[],
): string | null {
  let restored = "";
  let at = 0;
  let original = 0;
  const ordered = [...rewrites].sort((left, right) => left.start - right.start);
  for (const rewrite of ordered) {
    const unchanged = rewrite.start - original;
    if (unchanged < 0 || rewrite.end - rewrite.start !== rewrite.before.length) return null;
    restored += written.slice(at, at + unchanged);
    at += unchanged;
    if (!written.startsWith(rewrite.after, at)) return null;
    restored += rewrite.before;
    at += rewrite.after.length;
    original = rewrite.end;
  }
  restored += written.slice(at);
  if (ordered.length === 0) return restored;
  const destinations = new Set(
    markdownDestinations(restored).map((range) => `${range.start}:${range.end}`),
  );
  return ordered.every((rewrite) => destinations.has(`${rewrite.start}:${rewrite.end}`))
    ? restored
    : null;
}

/** What a document's links are, read in one parse of the whole document. */
export interface DocumentLinkFacts {
  /** The first definition of each label, by its CommonMark-normalized identifier. */
  first: Map<string, { start: number; end: number; text: string }>;
  /** Every reference and its identifier, resolved as the whole document resolves it. */
  references: Array<{ position: number; identifier: string }>;
  /** Every link, image, and definition destination. */
  destinations: Array<{ start: number; end: number }>;
}

/**
 * The definitions that take effect (CommonMark uses the first definition of a label, matched
 * case-insensitively with whitespace collapsed, and ignores later ones), every reference, and
 * every destination of a document. The split reads its parts from these, never parsing a part.
 */
export function documentLinkFacts(documentContent: string): DocumentLinkFacts {
  const { tree, destinations } = parseWithDestinations(documentContent);
  const first = new Map<string, { start: number; end: number; text: string }>();
  const references: Array<{ position: number; identifier: string }> = [];
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof node.identifier === "string" && Number.isSafeInteger(start)) {
      if (node.type === "definition" && !first.has(node.identifier) && Number.isSafeInteger(end))
        first.set(node.identifier, {
          start: start!,
          end: end!,
          text: documentContent.slice(start, end),
        });
      if (node.type === "linkReference" || node.type === "imageReference")
        references.push({ position: start!, identifier: node.identifier });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return { first, references, destinations };
}

/**
 * The first definitions the range `[start, end)` of a document uses but does not itself hold, as
 * written, one per line. Empty when it needs none.
 */
export function copiedReferenceDefinitions(
  facts: DocumentLinkFacts,
  range: { start: number; end: number },
): string {
  const copied = new Map<string, string>();
  for (const reference of facts.references) {
    if (reference.position < range.start || reference.position >= range.end) continue;
    const definition = facts.first.get(reference.identifier);
    if (
      definition !== undefined &&
      !(definition.start >= range.start && definition.end <= range.end)
    )
      copied.set(reference.identifier, definition.text);
  }
  return [...copied.values()].join("\n");
}
