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
  copiedReferenceDefinitions,
  documentLinkFacts,
  markdownDestinations,
  restoreSplitLinks,
  rewriteSplitLinks,
  type SplitAnchorFiles,
  type SplitAnchorTarget,
  type SplitLinkRewrite,
} from "./document-size-split-links.js";
import { githubHeadingSlugger } from "./document-size-partition.js";

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
  /** Reference definitions copied ahead of everything, so they take effect first, or "". */
  prefix: string;
  /** Table header rows copied ahead of the range, or null. */
  header: string | null;
  /** Reference definitions copied after the range, in the document's own file, or "". */
  appendix: string;
  /** Link destinations rewritten in `prefix + header + range + appendix`. */
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

/** What a document's split reads once, whatever its layout: its anchors and its definitions. */
export interface DocumentFacts {
  headings: ReturnType<typeof documentHeadingAnchors>;
  links: ReturnType<typeof documentLinkFacts>;
}

const BYTE_ORDER_MARK = "\uFEFF";

/** The facts of a document, read once; a leading byte order mark is not part of its text. */
export function documentFacts(content: string): DocumentFacts {
  const body = content.startsWith(BYTE_ORDER_MARK) ? content.slice(1) : content;
  return { headings: documentHeadingAnchors(body), links: documentLinkFacts(body) };
}

function layout(
  documentPath: string,
  content: string,
  facts: DocumentFacts,
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
  // A heading's anchor in its new file is numbered among that file's headings only, as GitHub
  // numbers them; an explicit HTML anchor keeps its name.
  const sluggers = new Map<string, (title: string) => string>();
  const anchors = new Map(
    facts.headings.map((heading) => {
      const file = fileAt(heading.position);
      if (heading.title.length === 0 && heading.anchor.length > 0)
        return [heading.anchor, { file, anchor: heading.anchor }] as const;
      const slug = sluggers.get(file) ?? githubHeadingSlugger();
      sluggers.set(file, slug);
      return [heading.anchor, { file, anchor: slug(heading.title) }] as const;
    }),
  );
  return { partition, paths, anchors };
}

function render(
  documentPath: string,
  content: string,
  facts: DocumentFacts,
  planned: Layout,
  foreignAnchors: SplitAnchorFiles,
): SplitDocument {
  const anchorFiles = new Map(foreignAnchors);
  anchorFiles.set(documentPath, planned.anchors);
  const { links: linkFacts } = facts;
  const unkept: string[] = [];
  const piece = (path: string, start: number, end: number, header: string | null): SplitPiece => {
    const range = content.slice(start, end);
    const { text: copied, uncopied } = copiedReferenceDefinitions(linkFacts, { start, end });
    unkept.push(...uncopied.map((label) => `${label} (its definition is not copied)`));
    // A part takes its copies first; the document's own file keeps its title first and takes
    // them after its preamble, which never holds a later duplicate of a part's definition.
    const own = path === documentPath;
    const prefix = !own && copied.length > 0 ? `${copied}\n\n` : "";
    const appendix =
      own && copied.length > 0 ? `${range.endsWith("\n") ? "\n" : "\n\n"}${copied}\n` : "";
    // The range's destinations come from the whole document's parse, shifted into this file;
    // only the small copied and repeated text around it is parsed again.
    const lead = `${prefix}${header ?? ""}`;
    const shift = lead.length - start;
    const tail = lead.length + (end - start);
    const destinations = [
      ...markdownDestinations(lead),
      ...linkFacts.destinations
        .filter((item) => item.start >= start && item.end <= end)
        .map((item) => ({ ...item, start: item.start + shift, end: item.end + shift })),
      ...(appendix.length === 0
        ? []
        : markdownDestinations(appendix).map((item) => ({
            ...item,
            start: item.start + tail,
            end: item.end + tail,
          }))),
    ];
    const links = rewriteSplitLinks({
      text: `${lead}${content.slice(start, end)}${appendix}`,
      fromPath: documentPath,
      toPath: path,
      anchorFiles,
      destinations,
    });
    unkept.push(...links.unkept);
    return {
      path,
      start,
      end,
      prefix,
      header,
      appendix,
      rewrites: links.rewrites,
      content: links.content,
    };
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
 * included, unless a single block exceeds it; such a part is marked oversized. A leading byte
 * order mark stays at the start of the document's own file, outside every part.
 */
export function splitOversizedDocument(
  documentPath: string,
  content: string,
  boundBytes = DOCUMENT_SINGLE_PASS_BYTES,
  foreignAnchors: SplitAnchorFiles = new Map(),
  facts: DocumentFacts = documentFacts(content),
): SplitDocument | UnsplittableReason {
  if (!content.startsWith(BYTE_ORDER_MARK))
    return splitText(documentPath, content, boundBytes, foreignAnchors, facts);
  const bomBytes = Buffer.byteLength(BYTE_ORDER_MARK);
  const split = splitText(
    documentPath,
    content.slice(1),
    boundBytes - bomBytes,
    foreignAnchors,
    facts,
  );
  if (typeof split === "string") return split;
  const move = (rewrite: SplitLinkRewrite) => ({
    ...rewrite,
    start: rewrite.start + 1,
    end: rewrite.end + 1,
  });
  return {
    ...split,
    index: {
      ...split.index,
      end: split.index.end + 1,
      rewrites: split.index.rewrites.map(move),
      content: `${BYTE_ORDER_MARK}${split.index.content}`,
    },
    parts: split.parts.map((part) => ({ ...part, start: part.start + 1, end: part.end + 1 })),
  };
}

function splitText(
  documentPath: string,
  content: string,
  boundBytes: number,
  foreignAnchors: SplitAnchorFiles,
  facts: DocumentFacts,
): SplitDocument | UnsplittableReason {
  if (hasDocumentPartsBlock(content)) return "document_parts_index";
  let partBytes = Math.max(1, boundBytes - partHeadroomBytes(boundBytes));
  let preambleBytes = partBytes;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const planned = layout(documentPath, content, facts, partBytes, preambleBytes);
    // A split whose every part is one block over the bound would only move the problem.
    if (planned === null || planned.partition.parts.every((part) => part.oversized))
      return "document_unsplittable";
    const split = render(documentPath, content, facts, planned, foreignAnchors);
    const indexBytes = Buffer.byteLength(split.index.content);
    const overflowing = split.parts.filter(
      (part) => !part.part.oversized && Buffer.byteLength(part.content) > boundBytes,
    );
    if (indexBytes <= boundBytes && overflowing.length === 0) return split;
    // Leave room for what the managed block and the rewritten links add, and plan again.
    if (indexBytes > boundBytes) preambleBytes -= indexBytes - boundBytes + 1024;
    if (overflowing.length > 0)
      partBytes -=
        Math.max(...overflowing.map((part) => Buffer.byteLength(part.content) - boundBytes)) + 1024;
    if (preambleBytes < 1 || partBytes < 1) return "document_unsplittable";
  }
  return "document_unsplittable";
}

/**
 * Whether a split can divide `content` at all, judged from its partition alone, without rendering
 * links: false for a split's own index, a document over the split maximum, and one without a cut
 * point that leaves a part within the bound. Inspection uses it to name the right next step.
 */
export function documentSizeSplittable(
  content: string,
  boundBytes = DOCUMENT_SINGLE_PASS_BYTES,
): boolean {
  const body = content.startsWith(BYTE_ORDER_MARK) ? content.slice(1) : content;
  if (Buffer.byteLength(content) > DOCUMENT_SIZE_SPLIT_MAXIMUM_BYTES) return false;
  if (hasDocumentPartsBlock(body)) return false;
  const partBytes = Math.max(1, boundBytes - partHeadroomBytes(boundBytes));
  const partition = partitionOversizedMarkdown(body, partBytes, partBytes);
  return partition !== null && !partition.parts.every((part) => part.oversized);
}

/**
 * The independent check of one written file: undo the recorded link rewrites, then drop the
 * copied definitions, the managed block, and the repeated header; what remains must equal the
 * original range byte for byte. Returns a reason, or null when the file restores exactly.
 */
export function restoreSplitPiece(
  original: string,
  written: string,
  piece: Pick<SplitPiece, "start" | "end" | "prefix" | "header" | "appendix" | "rewrites"> & {
    block?: string;
  },
): string | null {
  let text = written;
  if (piece.block !== undefined) {
    if (!text.endsWith(piece.block)) return "the managed block is not where the plan put it";
    text = text.slice(0, text.length - piece.block.length);
  }
  const restored = restoreSplitLinks(text, piece.rewrites);
  if (restored === null) return "a rewrite does not lie exactly on a link destination";
  if (!restored.startsWith(piece.prefix)) return "the copied definitions before it are missing";
  if (!restored.endsWith(piece.appendix)) return "the copied definitions after it are missing";
  const inner = restored.slice(piece.prefix.length, restored.length - piece.appendix.length);
  const header = piece.header ?? "";
  if (!inner.startsWith(header)) return "the repeated table header is missing";
  const range = inner.slice(header.length);
  return Buffer.from(range).equals(Buffer.from(original.slice(piece.start, piece.end)))
    ? null
    : "the written bytes differ from the original range";
}

export function byteOffset(content: string, offset: number): number {
  return Buffer.byteLength(content.slice(0, offset));
}
