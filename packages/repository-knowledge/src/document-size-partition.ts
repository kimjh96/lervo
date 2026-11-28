// The byte partition of a document too large to normalize in one pass (ADR-0653): the preamble the
// document keeps, then ordered parts, each a contiguous range of the original bytes. It splits
// between top-level CommonMark blocks, so never inside fenced code or a list, and splits a table
// that is too large on its own between rows, repeating its header row and delimiter row.
import { fromMarkdown } from "mdast-util-from-markdown";

import { RepositoryKnowledgeError } from "./types.js";

/** The largest document normalization rewrites in one pass; a larger one is split first. */
export const DOCUMENT_SINGLE_PASS_BYTES = 256 * 1024;

interface PositionedNode {
  type: string;
  depth?: number;
  value?: string;
  children?: PositionedNode[];
  position?: { start?: { offset?: number } };
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

interface Boundary {
  position: number;
  heading: { depth: number; title: string; locator: string } | null;
}

function nodeText(node: PositionedNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

/** Every top-level block start, with its heading when the block is one. */
function boundaries(content: string): Boundary[] {
  let root: PositionedNode;
  try {
    root = fromMarkdown(content) as PositionedNode;
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_unit_extraction_failed",
      "Markdown cannot be parsed safely as CommonMark structure.",
      undefined,
      { cause: error },
    );
  }
  const stack: Array<{ depth: number; title: string }> = [];
  return (root.children ?? []).flatMap((node): Boundary[] => {
    const position = node.position?.start?.offset;
    if (!Number.isSafeInteger(position)) return [];
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

/**
 * Splits `content` into a preamble and parts of at most `boundBytes` each: at the shallowest
 * heading level inside a range, deeper headings for a section still too large, and top-level
 * block boundaries where no heading helps. A block larger than the bound stays whole and is
 * marked oversized. Parts are packed in order, so the preamble and parts concatenate to `content`.
 */
export function partitionOversizedMarkdown(
  content: string,
  boundBytes: number,
): DocumentSizePartition {
  const blocks = boundaries(content);
  const byteAt = new Map<number, number>([[0, 0]]);
  let previous = 0;
  let previousBytes = 0;
  for (const position of [...blocks.map((block) => block.position), content.length].sort(
    (left, right) => left - right,
  )) {
    previousBytes += Buffer.byteLength(content.slice(previous, position));
    previous = position;
    byteAt.set(position, previousBytes);
  }
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

  const pack = (pieces: Piece[]): Piece[] => {
    const packed: Piece[] = [];
    for (const piece of pieces) {
      const last = packed[packed.length - 1];
      if (
        last !== undefined &&
        !last.oversized &&
        !piece.oversized &&
        piece.header === null &&
        size({ ...last, end: piece.end }) <= boundBytes
      )
        last.end = piece.end;
      else packed.push({ ...piece });
    }
    return packed;
  };
  // A pipe table between `start` and `end`, split between rows; the header and delimiter rows
  // lead every continuation. Null when the block is no table or a single row exceeds the bound.
  const tableRows = (start: number, end: number): Piece[] | null => {
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
      if (rows > 0 && size({ ...current, end: next }) > boundBytes) {
        pieces.push(current);
        current = { start: line, end: next, oversized: false, header: blank ? null : header };
        rows = blank ? 0 : 1;
      } else {
        current.end = next;
        if (!blank) rows += 1;
      }
      if (size(current) > boundBytes) return null;
    }
    pieces.push(current);
    return pieces;
  };
  const segments = (start: number, end: number, points: number[]): Array<[number, number]> => {
    const cuts = [start, ...points, end];
    return cuts.slice(0, -1).map((cut, index) => [cut, cuts[index + 1]!]);
  };
  const split = (start: number, end: number, minimumDepth: number): Piece[] => {
    if (bytes(start, end) <= boundBytes) return [{ start, end, oversized: false, header: null }];
    const inner = blocks.filter((block) => block.position > start && block.position < end);
    const headings = inner.filter(
      (block) => block.heading !== null && block.heading.depth >= minimumDepth,
    );
    if (headings.length > 0) {
      const depth = Math.min(...headings.map((block) => block.heading!.depth));
      const points = headings
        .filter((block) => block.heading!.depth === depth)
        .map((block) => block.position);
      return pack(segments(start, end, points).flatMap(([from, to]) => split(from, to, depth + 1)));
    }
    return pack(
      segments(
        start,
        end,
        inner.map((block) => block.position),
      ).flatMap(([from, to]): Piece[] =>
        bytes(from, to) <= boundBytes
          ? [{ start: from, end: to, oversized: false, header: null }]
          : (tableRows(from, to) ?? [{ start: from, end: to, oversized: true, header: null }]),
      ),
    );
  };

  // The document keeps what precedes its first section, so a title and introduction stay at the
  // document's path; everything after it is parts.
  const top = blocks.filter((block) => block.position > 0 && block.heading !== null);
  const topDepth = top.length === 0 ? null : Math.min(...top.map((block) => block.heading!.depth));
  const firstSection =
    topDepth === null ? null : top.find((block) => block.heading!.depth === topDepth)!.position;
  let pieces: Piece[];
  if (firstSection === null) pieces = split(0, content.length, 7);
  else
    pieces = [
      ...split(0, firstSection, topDepth! + 1),
      ...split(firstSection, content.length, topDepth!),
    ];
  if (pieces.length < 2)
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The oversized document has no block boundary to split at.",
    );
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
