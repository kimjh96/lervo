// ADR-0653: the pure, deterministic layout of a document size split: where each part goes, the
// Lervo-managed block the document keeps, and the split itself, which must reassemble the
// document's exact bytes.
import { basename, posix } from "node:path";

import {
  DOCUMENT_SINGLE_PASS_BYTES,
  partitionOversizedMarkdown,
  type DocumentSizePart,
} from "./document-size-partition.js";
import { rebaseMarkdownLinks } from "./repository-layout-references.js";
import { RepositoryKnowledgeError } from "./types.js";

/** The largest document Lervo splits: the bound its split lineage records. Larger is data. */
export const DOCUMENT_SIZE_SPLIT_MAXIMUM_BYTES = 16 * 1024 * 1024;
/** Parts per directory, the document layout's file capacity; more parts nest in groups. */
const PARTS_PER_DIRECTORY = 32;
const PART_BLOCK = "document-parts";

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

export interface SplitDocument {
  index: string;
  parts: Array<{ path: string; content: string; part: DocumentSizePart; rebased: number }>;
  partition: ReturnType<typeof partitionOversizedMarkdown>;
}

/**
 * The deterministic split of one document. The preamble and the parts' original ranges, without
 * any repeated table header, must reassemble `content` exactly, or it throws.
 */
export function splitOversizedDocument(
  documentPath: string,
  content: string,
  boundBytes = DOCUMENT_SINGLE_PASS_BYTES,
): SplitDocument {
  const partition = partitionOversizedMarkdown(content, boundBytes);
  const reassembled =
    content.slice(0, partition.preambleEnd) +
    partition.parts.map((part) => content.slice(part.start, part.end)).join("");
  const contiguous = partition.parts.every(
    (part, index) =>
      part.start === (index === 0 ? partition.preambleEnd : partition.parts[index - 1]!.end) &&
      part.end > part.start,
  );
  if (
    !contiguous ||
    partition.parts[partition.parts.length - 1]?.end !== content.length ||
    !Buffer.from(reassembled).equals(Buffer.from(content))
  )
    throw new RepositoryKnowledgeError(
      "knowledge_unit_extraction_failed",
      "The document split does not reassemble the document's exact bytes.",
    );
  const paths = documentSizePartPaths(
    documentPath,
    partition.parts.map((part) => part.title),
  );
  const parts = partition.parts.map((part, index) => {
    const rebased = rebaseMarkdownLinks(
      `${part.repeatedHeader ?? ""}${content.slice(part.start, part.end)}`,
      documentPath,
      paths[index]!,
    );
    return { path: paths[index]!, content: rebased.content, part, rebased: rebased.count };
  });
  const preamble = content.slice(0, partition.preambleEnd);
  const index = `${preamble}${preamble.endsWith("\n") ? "" : "\n"}${documentPartsBlock(
    documentPath,
    parts.map((part) => ({ path: part.path, title: part.part.title })),
  )}`;
  return { index, parts, partition };
}

export function byteOffset(content: string, offset: number): number {
  return Buffer.byteLength(content.slice(0, offset));
}
