// The byte partition of a document too large to normalize in one pass (ADR-0653): the preamble the
// document keeps, then ordered parts, each a contiguous range of the original bytes. It splits
// between top-level CommonMark blocks, so never inside fenced code, a list, or a Lervo-managed
// block, and splits a table that is too large on its own between rows, repeating its header row
// and delimiter row.
import { fromMarkdown } from "mdast-util-from-markdown";

import { RepositoryKnowledgeError } from "./types.js";

/** The largest document normalization rewrites in one pass; a larger one is split first. */
export const DOCUMENT_SINGLE_PASS_BYTES = 256 * 1024;

interface PositionedNode {
  type: string;
  depth?: number;
  value?: string;
  children?: PositionedNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

export interface DocumentSizePart {
  /** Character offsets into the original text, end exclusive. */
  start: number;
  end: number;
  /** The heading the part starts with, or the nearest one before it. */
  title: string | null;
  /** `heading:<path>` of that heading, or of the document for a part before any heading. */
  locator: string;
  /** A single block that still exceeds the bound; it is a part of its own, never cut. */
  oversized: boolean;
  /**
   * A table's header and delimiter rows, copied ahead of a part that continues the table. The part's
   * content is this prefix followed by the original range; removing it restores the original.
   */
  repeatedHeader: string | null;
}

export interface DocumentSizePartition {
  /** The preamble the document keeps: `[0, preambleEnd)`. */
  preambleEnd: number;
  parts: DocumentSizePart[];
}

/** A heading's position, text, and GitHub-style anchor, unique in the document. */
export interface DocumentHeadingAnchor {
  position: number;
  title: string;
  anchor: string;
}

interface Boundary {
  position: number;
  heading: { depth: number; title: string; locator: string } | null;
}

const MANAGED_BEGIN = /^<!--\s*lervo:begin\b/u;
const MANAGED_END = /^<!--\s*lervo:end\b/u;

function nodeText(node: PositionedNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function parse(content: string): PositionedNode {
  try {
    return fromMarkdown(content) as PositionedNode;
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_unit_extraction_failed",
      "Markdown cannot be parsed safely as CommonMark structure.",
      undefined,
      { cause: error },
    );
  }
}

/** Whether `content` already holds the Lervo-managed block that links a split document's parts. */
export function hasDocumentPartsBlock(content: string): boolean {
  return /^<!--\s*lervo:begin block=document-parts\b/mu.test(content);
}

/**
 * Every top-level block start a split may cut at, with its heading when the block is one. Blocks
 * inside a Lervo-managed region are not cut points, so a managed block always stays whole.
 */
function boundaries(root: PositionedNode): Boundary[] {
  const stack: Array<{ depth: number; title: string }> = [];
  let managed = false;
  return (root.children ?? []).flatMap((node): Boundary[] => {
    const position = node.position?.start?.offset;
    if (!Number.isSafeInteger(position)) return [];
    const html = node.type === "html" ? (node.value ?? "").trim() : "";
    if (managed) {
      if (MANAGED_END.test(html)) managed = false;
      return [];
    }
    if (MANAGED_BEGIN.test(html)) managed = !MANAGED_END.test(html.split("\n").pop() ?? "");
    if (node.type !== "heading") return [{ position: position!, heading: null }];
    const depth = node.depth ?? 0;
    const title = nodeText(node).trim().slice(0, 300);
    if (depth < 1 || depth > 6 || title.length === 0)
      return [{ position: position!, heading: null }];
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const locator = `heading:${[...stack.map((item) => item.title), title].join(" > ")}`.slice(
      0,
      500,
    );
    stack.push({ depth, title });
    return [{ position: position!, heading: { depth, title, locator } }];
  });
}

/** GitHub's anchor for a heading: lowercase, punctuation removed, spaces as hyphens. */
export function githubHeadingSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /gu, "-");
}

/** Every heading's anchor in document order, numbered as GitHub numbers repeated anchors. */
export function documentHeadingAnchors(content: string): DocumentHeadingAnchor[] {
  const seen = new Map<string, number>();
  const anchors: DocumentHeadingAnchor[] = [];
  const visit = (node: PositionedNode): void => {
    const position = node.position?.start?.offset;
    if (node.type === "heading" && Number.isSafeInteger(position)) {
      const title = nodeText(node).trim();
      const base = githubHeadingSlug(title);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.push({ position: position!, title, anchor: count === 0 ? base : `${base}-${count}` });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parse(content));
  return anchors;
}

/** The byte offset of each character position, computed in one pass over sorted positions. */
function byteOffsets(content: string, positions: readonly number[]): Map<number, number> {
  const byteAt = new Map<number, number>([[0, 0]]);
  let previous = 0;
  let previousBytes = 0;
  for (const position of [...positions].sort((left, right) => left - right)) {
    previousBytes += Buffer.byteLength(content.slice(previous, position));
    previous = position;
    byteAt.set(position, previousBytes);
  }
  return byteAt;
}

/**
 * Splits `content` into a preamble of at most `preambleBytes` and parts of at most `boundBytes`
 * each: at the shallowest heading level inside a range, deeper headings for a section still too
 * large, and top-level block boundaries where no heading helps. A block larger than the bound stays
 * whole and is marked oversized. Null when the document has no cut point that makes it smaller,
 * so it is one indivisible block. The preamble and parts concatenate to `content`.
 */
export function partitionOversizedMarkdown(
  content: string,
  boundBytes: number,
  preambleBytes = boundBytes,
): DocumentSizePartition | null {
  const blocks = boundaries(parse(content));
  const byteAt = byteOffsets(content, [...blocks.map((block) => block.position), content.length]);
  const bytes = (start: number, end: number) =>
    byteAt.has(start) && byteAt.has(end)
      ? byteAt.get(end)! - byteAt.get(start)!
      : Buffer.byteLength(content.slice(start, end));
  const nearest = (position: number) =>
    [...blocks].reverse().find((block) => block.position <= position && block.heading !== null)
      ?.heading ?? null;
  type Piece = { start: number; end: number; oversized: boolean; header: string | null };
  const size = (piece: Pick<Piece, "start" | "end" | "header">) =>
    Buffer.byteLength(piece.header ?? "") + bytes(piece.start, piece.end);

  const pack = (pieces: Piece[], bound: number): Piece[] => {
    const packed: Piece[] = [];
    for (const piece of pieces) {
      const last = packed[packed.length - 1];
      if (
        last !== undefined &&
        !last.oversized &&
        !piece.oversized &&
        piece.header === null &&
        size({ ...last, end: piece.end }) <= bound
      )
        last.end = piece.end;
      else packed.push({ ...piece });
    }
    return packed;
  };
  // A pipe table between `start` and `end`, split between rows; the header and delimiter rows
  // lead every continuation. Null when the block is no table or a single row exceeds the bound.
  const tableRows = (start: number, end: number, bound: number): Piece[] | null => {
    const lines: number[] = [];
    for (let at = start; at < end;) {
      lines.push(at);
      const newline = content.indexOf("\n", at);
      at = newline === -1 || newline >= end ? end : newline + 1;
    }
    if (
      lines.length < 4 ||
      !content.slice(lines[0], lines[1]).trimStart().startsWith("|") ||
      !/^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/u.test(content.slice(lines[1], lines[2]))
    )
      return null;
    const header = content.slice(lines[0], lines[2]);
    const pieces: Piece[] = [];
    let current: Piece = { start, end: lines[2]!, oversized: false, header: null };
    let rows = 0;
    for (const [index, line] of lines.slice(2).entries()) {
      const next = lines[index + 3] ?? end;
      // Trailing blank lines never open a header-only part: past the bound they go on without
      // the header, and packing joins them to what follows.
      const blank = content.slice(line, next).trim().length === 0;
      if (rows > 0 && size({ ...current, end: next }) > bound) {
        pieces.push(current);
        current = { start: line, end: next, oversized: false, header: blank ? null : header };
        rows = blank ? 0 : 1;
      } else {
        current.end = next;
        if (!blank) rows += 1;
      }
      if (size(current) > bound) return null;
    }
    pieces.push(current);
    return pieces;
  };
  const segments = (start: number, end: number, points: number[]): Array<[number, number]> => {
    const cuts = [start, ...points, end];
    return cuts.slice(0, -1).map((cut, index) => [cut, cuts[index + 1]!]);
  };
  const split = (start: number, end: number, minimumDepth: number, bound: number): Piece[] => {
    if (bytes(start, end) <= bound) return [{ start, end, oversized: false, header: null }];
    const inner = blocks.filter((block) => block.position > start && block.position < end);
    const headings = inner.filter(
      (block) => block.heading !== null && block.heading.depth >= minimumDepth,
    );
    if (headings.length > 0) {
      const depth = Math.min(...headings.map((block) => block.heading!.depth));
      const points = headings
        .filter((block) => block.heading!.depth === depth)
        .map((block) => block.position);
      return pack(
        segments(start, end, points).flatMap(([from, to]) => split(from, to, depth + 1, bound)),
        bound,
      );
    }
    return pack(
      segments(
        start,
        end,
        inner.map((block) => block.position),
      ).flatMap(([from, to]): Piece[] =>
        bytes(from, to) <= bound
          ? [{ start: from, end: to, oversized: false, header: null }]
          : (tableRows(from, to, bound) ?? [
              { start: from, end: to, oversized: true, header: null },
            ]),
      ),
      bound,
    );
  };

  // The document keeps what precedes its first section, so a title and introduction stay at the
  // document's path, within `preambleBytes`; everything after it is parts.
  const top = blocks.filter((block) => block.position > 0 && block.heading !== null);
  const topDepth = top.length === 0 ? null : Math.min(...top.map((block) => block.heading!.depth));
  const firstSection =
    topDepth === null ? null : top.find((block) => block.heading!.depth === topDepth)!.position;
  let pieces =
    firstSection === null
      ? split(0, content.length, 7, boundBytes)
      : [
          ...split(0, firstSection, topDepth! + 1, preambleBytes),
          ...split(firstSection, content.length, topDepth!, boundBytes),
        ];
  if (size(pieces[0]!) > preambleBytes) {
    const preamble = split(pieces[0]!.start, pieces[0]!.end, 7, preambleBytes);
    if (preamble.length < 2) return null;
    pieces = [...preamble, ...pieces.slice(1)];
  }
  if (pieces.length < 2) return null;
  const [preamble, ...rest] = pieces;
  return {
    preambleEnd: preamble!.end,
    parts: rest.map((piece) => {
      const heading = nearest(piece.start);
      return {
        start: piece.start,
        end: piece.end,
        title: heading?.title ?? null,
        locator: heading?.locator ?? "heading:(document)",
        oversized: piece.oversized,
        repeatedHeader: piece.header,
      };
    }),
  };
}
