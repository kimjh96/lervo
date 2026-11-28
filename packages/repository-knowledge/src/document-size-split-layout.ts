// ADR-0653: the pure, deterministic layout of a document size split: where each part goes, the
// Lervo-managed block the document keeps, how links follow the text, and the check that undoes
// every recorded change to the written bytes and compares them with the original ranges.
import { basename, posix } from "node:path";

import {
  DOCUMENT_SINGLE_PASS_BYTES,
  documentHeadingAnchors,
  hasDocumentPartsBlock,
  partitionOversizedMarkdown,
  type DocumentSizePart,
  type DocumentSizePartition,
} from "./document-size-partition.js";
import {
  documentReferenceDefinitions,
  missingReferenceDefinitions,
  restoreSplitLinks,
  rewriteSplitLinks,
  type SplitAnchorFiles,
  type SplitAnchorTarget,
  type SplitLinkRewrite,
} from "./document-size-split-links.js";
import { githubHeadingSlug } from "./document-size-partition.js";

/** The largest document Lervo splits: the bound its split lineage records. Larger is data. */
export const DOCUMENT_SIZE_SPLIT_MAXIMUM_BYTES = 16 * 1024 * 1024;
/** Parts per directory, the document layout's file capacity; more parts nest in groups. */
const PARTS_PER_DIRECTORY = 32;
const PART_BLOCK = "document-parts";
/** Room parts leave below the bound for rebased links and copied definitions, at most 8 KiB. */
const partHeadroomBytes = (bound: number) => Math.min(8 * 1024, Math.floor(bound / 16));

function slug(title: string | null): string {
  const value = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/u, "");
  return value.length === 0 ? "part" : value;
}

/** Each part's path: `<dir>/<stem>/<NN>-<slug>.md`, grouped by 32 when there are more. */
export function documentSizePartPaths(
  documentPath: string,
  titles: readonly (string | null)[],
): string[] {
  const directory = posix.join(posix.dirname(documentPath), basename(documentPath, ".md"));
  const width = Math.max(2, String(titles.length).length);
  const grouped = titles.length > PARTS_PER_DIRECTORY;
  return titles.map((title, index) => {
    const name = `${String(index + 1).padStart(width, "0")}-${slug(title)}.md`;
    return grouped
      ? posix.join(
          directory,
          String(Math.floor(index / PARTS_PER_DIRECTORY) + 1).padStart(2, "0"),
          name,
        )
      : posix.join(directory, name);
  });
}

function linkLabel(title: string | null, index: number): string {
  return (title ?? `Part ${index + 1}`).replace(/[[\]\\]/gu, (character) => `\\${character}`);
}

/** The Lervo-managed block the document keeps after its preamble: its parts, in order. */
export function documentPartsBlock(
  documentPath: string,
  parts: ReadonlyArray<{ path: string; title: string | null }>,
): string {
  const directory = posix.dirname(documentPath);
  const lines = parts.map(
    (part, index) =>
      `- [${linkLabel(part.title, index)}](${encodeURI(posix.relative(directory, part.path))})`,
  );
  return [
    `<!-- lervo:begin block=${PART_BLOCK} schema=1 -->`,
    ...lines,
    `<!-- lervo:end block=${PART_BLOCK} -->`,
    "",
  ].join("\n");
}

/** One written file of a split, with what the check must undo to reach its original range. */
export interface SplitPiece {
  path: string;
  /** Character range of the original document this file holds. */
  start: number;
  end: number;
  /** Table header rows copied ahead of the range, or null. */
  header: string | null;
  /** Reference definitions copied after the range, or "". */
  appendix: string;
  /** Link destinations rewritten in `header + range + appendix`. */
  rewrites: SplitLinkRewrite[];
  /** The bytes written. */
  content: string;
}

export interface SplitDocument {
  path: string;
  /** The document's own file: its preamble, then the managed block. */
  index: SplitPiece & { block: string };
  parts: Array<SplitPiece & { part: DocumentSizePart }>;
  /** Link destinations the split could not rewrite, named so none breaks silently. */
  unkept: string[];
  /** Where each of the document's heading anchors now lives. */
  anchors: Map<string, SplitAnchorTarget>;
}

/** Why a document over the bound is kept whole instead of split. */
export type UnsplittableReason = "document_unsplittable" | "document_parts_index";

interface Layout {
  partition: DocumentSizePartition;
  paths: string[];
  anchors: Map<string, SplitAnchorTarget>;
}

function layout(
  documentPath: string,
  content: string,
  partBytes: number,
  preambleBytes: number,
): Layout | null {
  const partition = partitionOversizedMarkdown(content, partBytes, preambleBytes);
  if (partition === null) return null;
  const paths = documentSizePartPaths(
    documentPath,
    partition.parts.map((part) => part.title),
  );
  const fileAt = (position: number) => {
    const index = partition.parts.findLastIndex((part) => part.start <= position);
    return index < 0 ? documentPath : paths[index]!;
  };
  // A heading's anchor in its new file is numbered among that file's headings only.
  const seen = new Map<string, Map<string, number>>();
  const anchors = new Map(
    documentHeadingAnchors(content).map((heading) => {
      const file = fileAt(heading.position);
      const counts = seen.get(file) ?? new Map<string, number>();
      seen.set(file, counts);
      const base = githubHeadingSlug(heading.title);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      return [heading.anchor, { file, anchor: count === 0 ? base : `${base}-${count}` }] as const;
    }),
  );
  return { partition, paths, anchors };
}

function render(
  documentPath: string,
  content: string,
  planned: Layout,
  foreignAnchors: SplitAnchorFiles,
): SplitDocument {
  const anchorFiles = new Map(foreignAnchors);
  anchorFiles.set(documentPath, planned.anchors);
  const definitions = documentReferenceDefinitions(content);
  const unkept: string[] = [];
  const piece = (path: string, start: number, end: number, header: string | null) => {
    const range = `${header ?? ""}${content.slice(start, end)}`;
    const appendix = missingReferenceDefinitions(range, definitions);
    const links = rewriteSplitLinks({
      text: `${range}${appendix}`,
      fromPath: documentPath,
      toPath: path,
      anchorFiles,
    });
    unkept.push(...links.unkept);
    return { path, start, end, header, appendix, rewrites: links.rewrites, content: links.content };
  };
  const { partition, paths } = planned;
  const parts = partition.parts.map((part, index) => ({
    ...piece(paths[index]!, part.start, part.end, part.repeatedHeader),
    part,
  }));
  const preamble = piece(documentPath, 0, partition.preambleEnd, null);
  const block = documentPartsBlock(
    documentPath,
    parts.map((part) => ({ path: part.path, title: part.part.title })),
  );
  const separator = preamble.content.endsWith("\n") ? "" : "\n";
  return {
    path: documentPath,
    index: {
      ...preamble,
      block: `${separator}${block}`,
      content: `${preamble.content}${separator}${block}`,
    },
    parts,
    unkept,
    anchors: planned.anchors,
  };
}

/**
 * The deterministic split of one document, or why it stays whole: a document that already links
 * its parts is a split's index and is never split again, and one without a cut point that makes it
 * smaller is one indivisible block. Every written file stays within `boundBytes`, the index
 * included, unless a single block exceeds it; such a part is marked oversized.
 */
export function splitOversizedDocument(
  documentPath: string,
  content: string,
  boundBytes = DOCUMENT_SINGLE_PASS_BYTES,
  foreignAnchors: SplitAnchorFiles = new Map(),
): SplitDocument | UnsplittableReason {
  if (hasDocumentPartsBlock(content)) return "document_parts_index";
  let partBytes = Math.max(1, boundBytes - partHeadroomBytes(boundBytes));
  let preambleBytes = partBytes;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const planned = layout(documentPath, content, partBytes, preambleBytes);
    // A split whose every part is one block over the bound would only move the problem.
    if (planned === null || planned.partition.parts.every((part) => part.oversized))
      return "document_unsplittable";
    const split = render(documentPath, content, planned, foreignAnchors);
    const indexBytes = Buffer.byteLength(split.index.content);
    const overflowing = split.parts.filter(
      (part) => !part.part.oversized && Buffer.byteLength(part.content) > boundBytes,
    );
    if (indexBytes <= boundBytes && overflowing.length === 0) return split;
    // Leave room for what the managed block and the rewritten links add, and plan again.
    if (indexBytes > boundBytes) preambleBytes -= indexBytes - boundBytes + 1024;
    if (overflowing.length > 0) partBytes = Math.floor(partBytes * 0.9);
    if (preambleBytes < 1 || partBytes < 1) return "document_unsplittable";
  }
  return "document_unsplittable";
}

/**
 * Each document's split, its links following headings across every document split with it. A
 * document kept whole is returned with its reason instead.
 */
export function splitDocuments<Source extends { path: string; content: string }>(
  sources: readonly Source[],
  boundBytes: number,
): Array<{ source: Source; split: SplitDocument | UnsplittableReason }> {
  const first = sources.map((source) => ({
    source,
    split: splitOversizedDocument(source.path, source.content, boundBytes),
  }));
  const anchors = new Map(
    first.flatMap(({ source, split }) =>
      typeof split === "string" ? [] : [[source.path, split.anchors] as const],
    ),
  );
  if (anchors.size < 2) return first;
  const names = [...anchors.keys()].map((path) => `${posix.basename(path)}#`);
  return first.map(({ source, split }) =>
    // Only a document that names another split document's heading renders again.
    typeof split === "string" || !names.some((name) => source.content.includes(name))
      ? { source, split }
      : {
          source,
          split: splitOversizedDocument(
            source.path,
            source.content,
            boundBytes,
            new Map([...anchors].filter(([path]) => path !== source.path)),
          ),
        },
  );
}

/**
 * The independent check of one written file: undo the recorded link rewrites, then drop the
 * copied definitions, the managed block, and the repeated header; what remains must equal the
 * original range byte for byte. Returns a reason, or null when the file restores exactly.
 */
export function restoreSplitPiece(
  original: string,
  written: string,
  piece: Pick<SplitPiece, "start" | "end" | "header" | "appendix" | "rewrites"> & {
    block?: string;
  },
): string | null {
  let text = written;
  if (piece.block !== undefined) {
    if (!text.endsWith(piece.block)) return "the managed block is not where the plan put it";
    text = text.slice(0, text.length - piece.block.length);
  }
  const restored = restoreSplitLinks(text, piece.rewrites);
  if (restored === null) return "a rewritten link is not where the plan recorded it";
  if (!restored.endsWith(piece.appendix)) return "the copied definitions are missing";
  const withoutAppendix = restored.slice(0, restored.length - piece.appendix.length);
  const header = piece.header ?? "";
  if (!withoutAppendix.startsWith(header)) return "the repeated table header is missing";
  const range = withoutAppendix.slice(header.length);
  return Buffer.from(range).equals(Buffer.from(original.slice(piece.start, piece.end)))
    ? null
    : "the written bytes differ from the original range";
}

export function byteOffset(content: string, offset: number): number {
  return Buffer.byteLength(content.slice(0, offset));
}
