import { createManagedBlockPatchCandidate, parseManagedMarkdownBlocks } from "@lervo/documents";

import type { DocumentFreshnessHunk } from "./document-freshness-contract.js";
import { applyDocumentFreshnessHunks } from "./document-freshness-hunks.js";
import { sha256 } from "./integrity.js";

/**
 * The bytes an apply writes. Hunk ranges always refer to the original source, so the output is
 * the original with every earlier and newly approved hunk applied. When every new hunk sits inside
 * a `lervo_v1` block, the result is produced from the current bytes through the ADR-0022
 * managed-block patch path, block by block, and must equal the direct result; a mismatch throws
 * instead of writing.
 */
export function documentFreshnessSelectedOutput(input: {
  documentPath: string;
  original: Uint8Array;
  /** Bytes currently at the path: the original plus the earlier hunks. */
  current: Uint8Array;
  hunks: readonly DocumentFreshnessHunk[];
  appliedHunkIds: ReadonlySet<string>;
  newHunkIds: ReadonlySet<string>;
}): Uint8Array {
  const direct = applyDocumentFreshnessHunks(
    input.original,
    input.hunks.filter(
      (hunk) => input.appliedHunkIds.has(hunk.hunkId) || input.newHunkIds.has(hunk.hunkId),
    ),
  );
  const newHunks = input.hunks.filter((hunk) => input.newHunkIds.has(hunk.hunkId));
  if (newHunks.length === 0 || !newHunks.every((hunk) => hunk.managedBlockId !== null))
    return direct;
  const target = parseManagedMarkdownBlocks(direct);
  let patched = new Uint8Array(input.current);
  for (const blockId of [...new Set(newHunks.map((hunk) => hunk.managedBlockId!))]) {
    const block = target.blocks.find((item) => item.blockId === blockId);
    if (block === undefined) throw new Error("The managed block disappeared from the output.");
    patched = new Uint8Array(
      createManagedBlockPatchCandidate({
        source: {
          path: input.documentPath,
          bytes: patched,
          byteCount: patched.byteLength,
          contentHash: sha256(patched),
        },
        blockId,
        replacementBytes: direct.subarray(block.contentRange.start, block.contentRange.end),
      }).outputBytes,
    );
  }
  if (sha256(patched) !== sha256(direct))
    throw new Error("The managed-block patch output differs from the verified hunk output.");
  return patched;
}
