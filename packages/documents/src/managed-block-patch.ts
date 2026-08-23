import {
  validateSchema,
  type ManagedBlockPatchCandidate,
  type ManagedBlockPatchCandidateArtifact,
} from "@lervo/schemas";

import { normalizeScanPath } from "./filesystem.js";
import { sha256 } from "./hash.js";
import {
  calculateManagedBlockPatchCandidateId,
  managedBlockPatchCandidateBytes,
} from "./integrity.js";
import { parseManagedMarkdownBlocks } from "./managed-block-parser.js";
import type { ParsedManagedBlock } from "./managed-block-types.js";
import {
  ManagedBlockPatchError,
  type CreateManagedBlockPatchCandidateInput,
  type ManagedBlockPatchCandidateResult,
} from "./managed-block-patch-types.js";

const BLOCK_ID = /^[a-z][a-z0-9_-]{0,99}$/;
const MAXIMUM_REPLACEMENT_BYTES = 8 * 1024;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function slice(bytes: Uint8Array, start: number, end?: number): Uint8Array {
  return bytes.slice(start, end);
}

function replaceRange(
  source: Uint8Array,
  start: number,
  end: number,
  replacement: Uint8Array,
): Uint8Array {
  const output = new Uint8Array(source.byteLength - (end - start) + replacement.byteLength);
  output.set(source.subarray(0, start));
  output.set(replacement, start);
  output.set(source.subarray(end), start + replacement.byteLength);
  return output;
}

function markerBytesEqual(
  sourceBytes: Uint8Array,
  sourceBlock: ParsedManagedBlock,
  outputBytes: Uint8Array,
  outputBlock: ParsedManagedBlock,
): boolean {
  return bytesEqual(
    slice(sourceBytes, sourceBlock.startMarkerRange.start, sourceBlock.startMarkerRange.end),
    slice(outputBytes, outputBlock.startMarkerRange.start, outputBlock.startMarkerRange.end),
  ) && bytesEqual(
    slice(sourceBytes, sourceBlock.endMarkerRange.start, sourceBlock.endMarkerRange.end),
    slice(outputBytes, outputBlock.endMarkerRange.start, outputBlock.endMarkerRange.end),
  );
}

function sameBlockTopology(
  sourceBytes: Uint8Array,
  sourceBlocks: readonly ParsedManagedBlock[],
  outputBytes: Uint8Array,
  outputBlocks: readonly ParsedManagedBlock[],
): boolean {
  return sourceBlocks.length === outputBlocks.length && sourceBlocks.every((sourceBlock, index) => {
    const outputBlock = outputBlocks[index];
    return outputBlock !== undefined &&
      sourceBlock.blockId === outputBlock.blockId &&
      sourceBlock.markerFamily === outputBlock.markerFamily &&
      markerBytesEqual(sourceBytes, sourceBlock, outputBytes, outputBlock);
  });
}

function validateRequest(input: CreateManagedBlockPatchCandidateInput): string {
  if (!BLOCK_ID.test(input.blockId)) {
    throw new ManagedBlockPatchError(
      "invalid_patch_request",
      "The managed block patch block ID does not satisfy the contract.",
    );
  }
  try {
    const path = normalizeScanPath(input.source.path);
    if (path === "." || path.endsWith("/")) throw new Error("source must be a file path");
    return path;
  } catch (error) {
    throw new ManagedBlockPatchError(
      "invalid_patch_request",
      "The managed block patch source path is not a safe repository-relative path.",
      { cause: error },
    );
  }
}

function validateReplacement(replacement: Uint8Array): void {
  if (replacement.byteLength > MAXIMUM_REPLACEMENT_BYTES) {
    throw new ManagedBlockPatchError(
      "replacement_too_large",
      "The managed block replacement exceeds the 8 KiB limit.",
    );
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(replacement);
  } catch (error) {
    throw new ManagedBlockPatchError(
      "replacement_invalid_utf8",
      "The managed block replacement must be valid UTF-8.",
      { cause: error },
    );
  }
}

export function createManagedBlockPatchCandidate(
  input: CreateManagedBlockPatchCandidateInput,
): ManagedBlockPatchCandidateResult {
  const sourcePath = validateRequest(input);
  const sourceBytes = new Uint8Array(input.source.bytes);
  const replacementBytes = new Uint8Array(input.replacementBytes);
  validateReplacement(replacementBytes);

  if (input.source.byteCount !== sourceBytes.byteLength ||
      input.source.contentHash !== sha256(sourceBytes)) {
    throw new ManagedBlockPatchError(
      "source_changed",
      "The managed block patch source differs from the byte count or hash bound to the request.",
    );
  }

  const parsedSource = parseManagedMarkdownBlocks(sourceBytes);
  if (parsedSource.status !== "valid") {
    throw new ManagedBlockPatchError(
      "source_structure_invalid",
      "The Markdown structure of the managed block patch source cannot be determined safely.",
    );
  }
  const target = parsedSource.blocks.find((block) => block.blockId === input.blockId);
  if (target === undefined) {
    throw new ManagedBlockPatchError(
      "block_not_found",
      "The requested managed block was not found in the source.",
    );
  }
  if (target.markerFamily !== "lervo_v1") {
    throw new ManagedBlockPatchError(
      "legacy_marker_not_writable",
      "A legacy product marker cannot be used as patch output before migration.",
    );
  }

  const existingContent = slice(sourceBytes, target.contentRange.start, target.contentRange.end);
  if (bytesEqual(existingContent, replacementBytes)) {
    throw new ManagedBlockPatchError(
      "no_changes",
      "The replacement is identical to the existing managed block content.",
    );
  }

  const outputBytes = replaceRange(
    sourceBytes,
    target.contentRange.start,
    target.contentRange.end,
    replacementBytes,
  );
  const parsedOutput = parseManagedMarkdownBlocks(outputBytes);
  const outputTarget = parsedOutput.blocks.find((block) => block.blockId === input.blockId);
  const prefixUnchanged = bytesEqual(
    slice(sourceBytes, 0, target.contentRange.start),
    slice(outputBytes, 0, target.contentRange.start),
  );
  const outputSuffixStart = target.contentRange.start + replacementBytes.byteLength;
  const suffixUnchanged = bytesEqual(
    slice(sourceBytes, target.contentRange.end),
    slice(outputBytes, outputSuffixStart),
  );
  if (
    parsedOutput.status !== "valid" || outputTarget === undefined ||
    !sameBlockTopology(sourceBytes, parsedSource.blocks, outputBytes, parsedOutput.blocks) ||
    !bytesEqual(
      slice(outputBytes, outputTarget.contentRange.start, outputTarget.contentRange.end),
      replacementBytes,
    ) || !prefixUnchanged || !suffixUnchanged
  ) {
    throw new ManagedBlockPatchError(
      "output_structure_invalid",
      "The replacement result does not satisfy the managed block structure and byte-preservation contract.",
    );
  }

  const candidateContent: Omit<ManagedBlockPatchCandidate, "candidateId"> = {
    schemaVersion: 1,
    disposition: "review_required",
    writesAllowed: false,
    source: {
      path: sourcePath,
      contentHash: input.source.contentHash,
      byteCount: sourceBytes.byteLength,
    },
    parser: {
      parserId: parsedSource.parserId,
      parserVersion: parsedSource.parserVersion,
    },
    target: {
      blockId: target.blockId,
      markerFamily: target.markerFamily,
      fullRange: target.fullRange,
      contentRange: target.contentRange,
      contentHash: sha256(existingContent),
    },
    replacement: {
      contentHash: sha256(replacementBytes),
      byteCount: replacementBytes.byteLength,
    },
    output: {
      contentHash: sha256(outputBytes),
      byteCount: outputBytes.byteLength,
      contentRange: outputTarget.contentRange,
    },
    assurances: {
      onlyTargetContentChanged: true,
      markerBytesUnchanged: true,
      outputStructureValid: true,
    },
  };
  const candidate: ManagedBlockPatchCandidate = {
    ...candidateContent,
    candidateId: calculateManagedBlockPatchCandidateId(candidateContent),
  };
  if (!validateSchema("managedBlockPatchCandidate", candidate).valid) {
    throw new ManagedBlockPatchError(
      "candidate_contract_invalid",
      "The managed block patch candidate cannot be made schema-valid.",
    );
  }
  const candidateBytes = managedBlockPatchCandidateBytes(candidate);
  const contentHash = sha256(candidateBytes);
  const artifact: ManagedBlockPatchCandidateArtifact = {
    schemaVersion: 1,
    artifactId: `art_${contentHash.slice("sha256:".length, "sha256:".length + 16)}`,
    contentHash,
    byteCount: candidateBytes.byteLength,
    candidate,
  };
  if (!validateSchema("managedBlockPatchCandidateArtifact", artifact).valid) {
    throw new ManagedBlockPatchError(
      "candidate_contract_invalid",
      "The managed block patch candidate artifact cannot be made schema-valid.",
    );
  }
  return { artifact, candidateBytes, outputBytes };
}
