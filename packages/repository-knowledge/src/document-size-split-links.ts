// ADR-0653: links across a document size split. A part moves into the document's directory, so its
// relative links are rebased; a link to a heading follows the heading into the part that now holds
// it; a reference definition travels with each part that uses it. Destinations are located by the
// CommonMark parser, never by searching text, and every rewrite is recorded, so the check can
// undo it on exactly that destination and compare the written bytes with the original range.
import { posix } from "node:path";

import { fromMarkdown, type CompileContext, type Token } from "mdast-util-from-markdown";

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
  value?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: MarkdownNode[];
}

/** A destination the split may rewrite: a link, image, or definition, or an HTML `src`/`href`. */
export interface LinkDestination {
  start: number;
  end: number;
  /** A footnote definition's text is no destination; it is never rewritten. */
  footnote: boolean;
}

/** A footnote, `[^label]`, which CommonMark without GFM reads as a link definition. */
const isFootnoteLabel = (label: string | undefined) => (label ?? "").startsWith("^");

const HTML_REFERENCE = /\s(?:src|href)\s*=\s*(["'])([^"']*)\1/giu;

/**
 * Every destination of `text` as the parser reads it, without the angle brackets of
 * `<destination>`, and the `src` and `href` values of its HTML. Ranges never overlap, so a nested
 * link or a destination that contains another's text is rewritten exactly once, in its own place.
 */
export function markdownDestinations(text: string): LinkDestination[] {
  return parseWithDestinations(text).destinations;
}

/**
 * The parser's tree and destinations of `text`, at offsets of `text` itself: the parser drops a
 * leading byte order mark from its offsets, so they are moved back past it. A part is parsed
 * as a document of its own, so nothing here depends on where the text starts, such as front matter.
 */
function parseWithDestinations(text: string): {
  tree: MarkdownNode;
  destinations: LinkDestination[];
  shift: number;
} {
  const shift = text.startsWith("\uFEFF") ? 1 : 0;
  const destinations: LinkDestination[] = [];
  const push = (start: number, end: number, footnote: boolean) => {
    if (end > start) destinations.push({ start, end, footnote });
  };
  function record(this: CompileContext, token: Token): void {
    let start = token.start.offset + shift;
    let end = token.end.offset + shift;
    if (text[start] === "<" && text[end - 1] === ">") {
      start += 1;
      end -= 1;
    }
    const node = this.stack[this.stack.length - 1] as MarkdownNode | undefined;
    push(start, end, node?.type === "definition" && isFootnoteLabel(node.label));
  }
  const tree = fromMarkdown(text, {
    mdastExtensions: [{ exit: { resourceDestination: record, definitionDestination: record } }],
  }) as MarkdownNode;
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (node.type === "html" && Number.isSafeInteger(start) && Number.isSafeInteger(end)) {
      const from = start! + shift;
      for (const match of text.slice(from, end! + shift).matchAll(HTML_REFERENCE)) {
        const at = from + match.index! + match[0].length - 1 - match[2]!.length;
        push(at, at + match[2]!.length, false);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  destinations.sort((left, right) => left.start - right.start);
  return { tree, destinations, shift };
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/|\/\/)/iu;

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A destination's path as a file name: CommonMark backslash escapes and percent-encoding undone. */
export function destinationPath(raw: string): string {
  return decoded(raw.replace(/\\([!-/:-@[-`{-~])/gu, "$1"));
}

/** A raw destination's path, query, and fragment. */
export function destinationParts(raw: string): { path: string; query: string; fragment: string } {
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/u.exec(raw);
  return {
    path: match?.[1] ?? "",
    query: match?.[2] ?? "",
    fragment: (match?.[3] ?? "").slice(1),
  };
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
 * destination, or `unkept` when it names a heading of a split document that no file holds. A
 * rebased path keeps its original characters, escapes included, after the new directory prefix.
 */
function rewrittenUrl(
  url: string,
  fromPath: string,
  toPath: string,
  anchorFiles: SplitAnchorFiles,
): string | "unkept" | null {
  if (url.length === 0 || EXTERNAL.test(url)) return null;
  const { path, query, fragment } = destinationParts(url);
  const target =
    path.length === 0
      ? fromPath
      : posix.normalize(posix.join(posix.dirname(fromPath), destinationPath(path)));
  const anchors = anchorFiles.get(target);
  if (anchors !== undefined && fragment.length > 0) {
    const holder = anchorFile(anchors, fragment);
    if (holder === undefined) return "unkept";
    const file = holder.file === toPath ? "" : posix.relative(posix.dirname(toPath), holder.file);
    // A repeated heading's anchor is numbered within its new file, so it may change.
    const anchor = decoded(fragment) === holder.anchor ? fragment : holder.anchor;
    return `${encodeURI(file)}${query}#${anchor}`;
  }
  const prefix = posix.relative(posix.dirname(toPath), posix.dirname(fromPath));
  if (path.length === 0 || prefix.length === 0) return null;
  let rebased = posix.normalize(posix.join(prefix, path));
  if (!rebased.startsWith(".") && path.startsWith("./")) rebased = `./${rebased}`;
  return `${rebased}${url.slice(path.length)}`;
}

/**
 * Rewrites the destinations of `text`, written to `toPath` from a document at `fromPath`. A
 * destination naming a heading no file holds stays as is and is returned in `unkept`, never
 * dropped silently. A footnote's text is never rewritten.
 */
export function rewriteSplitLinks(input: {
  text: string;
  fromPath: string;
  toPath: string;
  anchorFiles: SplitAnchorFiles;
  /** The destinations of `text`, when the caller read them already; otherwise they are parsed. */
  destinations?: readonly LinkDestination[];
}): { content: string; rewrites: SplitLinkRewrite[]; unkept: string[] } {
  const rewrites: SplitLinkRewrite[] = [];
  const unkept: string[] = [];
  for (const range of input.destinations ?? markdownDestinations(input.text)) {
    if (range.footnote) continue;
    const before = input.text.slice(range.start, range.end);
    const after = rewrittenUrl(before, input.fromPath, input.toPath, input.anchorFiles);
    if (after === "unkept") unkept.push(before);
    else if (after !== null && after !== before)
      rewrites.push({ start: range.start, end: range.end, before, after });
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
 * does not lie exactly on a rewritable destination the parser reads in the restored text.
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
    markdownDestinations(restored)
      .filter((range) => !range.footnote)
      .map((range) => `${range.start}:${range.end}`),
  );
  return ordered.every((rewrite) => destinations.has(`${rewrite.start}:${rewrite.end}`))
    ? restored
    : null;
}

/** A definition a part may copy: where it is, the text to copy, and whether it copies whole. */
export interface CopyableDefinition {
  start: number;
  end: number;
  text: string;
  copyable: boolean;
}

/** What a document's links are, read in one parse of the whole document. */
export interface DocumentLinkFacts {
  /**
   * The first definition of each label, by its CommonMark-normalized identifier, as the text a
   * part copies: itself, or a bare `[label]: destination` when it spans lines or sits in a
   * container such as a block quote. A footnote (`[^label]: text`, read as GitHub reads it) is
   * keyed `^label` and copied as written; one that continues on indented lines or sits in a
   * container cannot be copied whole.
   */
  first: Map<string, CopyableDefinition>;
  /** Every reference and footnote reference, resolved as the whole document resolves it. */
  references: Array<{ position: number; identifier: string }>;
  /** Every destination. */
  destinations: LinkDestination[];
}

const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:/u;
const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\](?!:)/gu;
const footnoteKey = (label: string) => `^${label}`.toLowerCase();

/** A definition's text as a part copies it, and whether it copies whole. */
function copyableDefinition(
  content: string,
  node: MarkdownNode,
  range: { start: number; end: number },
  topLevel: boolean,
  destination: LinkDestination | undefined,
): CopyableDefinition {
  const text = content.slice(range.start, range.end);
  const footnote = node.type !== "definition" || isFootnoteLabel(node.label);
  if (footnote) {
    // A footnote that continues on indented lines is more than what the parser read.
    const continued = /^\n(?:\n)?(?: {4}|\t)/u.test(content.slice(range.end, range.end + 7));
    return { ...range, text, copyable: topLevel && !continued };
  }
  const bare = !topLevel || text.includes("\n");
  if (!bare || destination === undefined) return { ...range, text, copyable: !bare };
  // The destination with its angle brackets, and a title that ends on the same line.
  const from = destination.start - (content[destination.start - 1] === "<" ? 1 : 0);
  let to = destination.end + (content[destination.end] === ">" ? 1 : 0);
  if (!content.slice(to, range.end).includes("\n")) to = range.end;
  return {
    ...range,
    text: `[${node.label ?? node.identifier}]: ${content.slice(from, to)}`,
    copyable: true,
  };
}

/**
 * The definitions that take effect (CommonMark uses the first definition of a label, matched
 * case-insensitively with whitespace collapsed, and ignores later ones), every reference, and
 * every destination of a document. The split reads its parts from these, never parsing a part.
 */
export function documentLinkFacts(content: string): DocumentLinkFacts {
  const { tree, destinations, shift } = parseWithDestinations(content);
  const first = new Map<string, CopyableDefinition>();
  const references: Array<{ position: number; identifier: string }> = [];
  const visit = (node: MarkdownNode, parent: MarkdownNode | null): void => {
    const at = node.position?.start?.offset;
    const until = node.position?.end?.offset;
    if (at !== undefined && until !== undefined) {
      const range = { start: at + shift, end: until + shift };
      const topLevel = parent?.type === "root";
      const footnote =
        node.type === "paragraph"
          ? FOOTNOTE_DEFINITION.exec(content.slice(range.start, range.start + 512))
          : null;
      const key =
        node.type === "definition" && typeof node.identifier === "string"
          ? node.identifier
          : footnote === null
            ? null
            : footnoteKey(footnote[1]!);
      if (key !== null && !first.has(key)) {
        const destination = destinations.find(
          (item) => item.start >= range.start && item.end <= range.end,
        );
        first.set(key, copyableDefinition(content, node, range, topLevel, destination));
      }
      if (
        (node.type === "linkReference" || node.type === "imageReference") &&
        typeof node.identifier === "string"
      )
        references.push({ position: range.start, identifier: node.identifier });
      if (node.type === "text")
        for (const match of content.slice(range.start, range.end).matchAll(FOOTNOTE_REFERENCE))
          references.push({
            position: range.start + match.index!,
            identifier: footnoteKey(match[1]!),
          });
    }
    for (const child of node.children ?? []) visit(child, node);
  };
  visit(tree, null);
  return { first, references, destinations };
}

/**
 * The first definitions the range `[start, end)` of a document uses but does not itself hold, as
 * the text to copy, and the labels whose definition cannot be copied whole. Link definitions come
 * one per line; each footnote follows after a blank line, so no definition continues another's
 * paragraph.
 */
export function copiedReferenceDefinitions(
  facts: DocumentLinkFacts,
  range: { start: number; end: number },
): { text: string; uncopied: string[] } {
  const copied = new Map<string, string>();
  const uncopied = new Set<string>();
  for (const reference of facts.references) {
    if (reference.position < range.start || reference.position >= range.end) continue;
    const definition = facts.first.get(reference.identifier);
    if (
      definition === undefined ||
      (definition.start >= range.start && definition.end <= range.end)
    )
      continue;
    if (definition.copyable) copied.set(reference.identifier, definition.text);
    else uncopied.add(`[${reference.identifier}]`);
  }
  const entries = [...copied];
  const links = entries.filter(([key]) => !key.startsWith("^")).map(([, text]) => text);
  const notes = entries.filter(([key]) => key.startsWith("^")).map(([, text]) => text);
  return {
    text: [links.join("\n"), ...notes].filter((text) => text.length > 0).join("\n\n"),
    uncopied: [...uncopied],
  };
}
