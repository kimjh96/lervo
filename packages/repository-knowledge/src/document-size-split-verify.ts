// ADR-0653: the deterministic check of one document of a size split, and of one linking document.
// The plan runs it on every document before offering it, so a document that fails is reported and
// left whole instead of failing the plan; the cross-check runs it again before anything is written.
import { restoreSplitPiece } from "./document-size-split-layout.js";
import { restoreSplitLinks, type SplitLinkRewrite } from "./document-size-split-links.js";
import type { DocumentSizeSplitDocument } from "./document-size-split-contract.js";
import { sha256 } from "./integrity.js";

/** The character offset of a byte offset in `content`, or null when it splits a character. */
function characterOffset(content: string, byteOffset: number): number | null {
  const prefix = Buffer.from(content).subarray(0, byteOffset).toString("utf8");
  return Buffer.byteLength(prefix) === byteOffset ? prefix.length : null;
}

/**
 * Why a split document's written files do not restore to `original`, its exact current text, or
 * null when they do: for every file the recorded link rewrites, the copied definitions, the
 * managed block, and a repeated table header are undone, and what remains must equal its original
 * byte range; the ranges must cover the document in order.
 */
export function splitDocumentFailure(
  original: string,
  document: DocumentSizeSplitDocument,
  contents: ReadonlyMap<string, string>,
): { path: string; reason: string } | null {
  if (sha256(original) !== document.beforeHash)
    return { path: document.path, reason: "it changed after the split was planned" };
  const ranges = [
    { ...document, startByte: 0, endByte: document.preambleByteCount },
    ...document.parts,
  ];
  let expectedStart = 0;
  for (const [index, range] of ranges.entries()) {
    const start = characterOffset(original, range.startByte);
    const end = characterOffset(original, range.endByte);
    const written = contents.get(range.path);
    if (
      range.startByte !== expectedStart ||
      start === null ||
      end === null ||
      written === undefined
    )
      return { path: range.path, reason: "its range does not continue the document" };
    const reason = restoreSplitPiece(original, written, {
      start,
      end,
      prefix: range.definitionsBefore,
      header: range.repeatedHeader,
      appendix: range.definitionsAfter,
      rewrites: range.linkRewrites,
      ...(index === 0 ? { block: document.partsBlock } : {}),
    });
    if (reason !== null) return { path: range.path, reason };
    expectedStart = range.endByte;
  }
  return expectedStart === Buffer.byteLength(original)
    ? null
    : { path: document.path, reason: "its parts end before the document does" };
}

/** Whether a linking document's written text differs from `current` only by its rewrites. */
export function referenceUpdateRestores(
  current: string,
  beforeHash: string,
  written: string | undefined,
  rewrites: readonly SplitLinkRewrite[],
): boolean {
  return (
    sha256(current) === beforeHash &&
    written !== undefined &&
    restoreSplitLinks(written, rewrites) === current
  );
}
