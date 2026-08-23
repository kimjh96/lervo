import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  calculateManagedBlockPatchCandidateId,
  createManagedBlockPatchCandidate,
  parseManagedMarkdownBlocks,
  type ManagedBlockPatchSource,
} from "../src/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const previousProductPrefix = "ro" + "ven";

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function source(path: string, text: string): ManagedBlockPatchSource {
  const bytes = encoder.encode(text);
  return { path, bytes, byteCount: bytes.byteLength, contentHash: sha256(bytes) };
}

function fixtureSource(): string {
  return [
    "Human-authored preface.",
    "",
    "<!-- lervo:begin block=summary schema=1 -->",
    "Existing summary.",
    "<!-- lervo:end block=summary -->",
    "",
    "User content between the two blocks.",
    "",
    "<!-- lervo:begin block=details schema=1 -->",
    "Existing details.",
    "<!-- lervo:end block=details -->",
    "",
    "Human-authored epilogue.",
    "",
  ].join("\r\n");
}

describe("managed block patch candidate", () => {
  it("changes only target content and binds review artifacts to every byte hash", () => {
    const originalText = fixtureSource();
    const input = source("README.md", originalText);
    const replacement = encoder.encode("New summary.\r\nSecond line.\r\n");
    const sourceSnapshot = input.bytes.slice();
    const replacementSnapshot = replacement.slice();

    const result = createManagedBlockPatchCandidate({
      source: input,
      blockId: "summary",
      replacementBytes: replacement,
    });
    const second = createManagedBlockPatchCandidate({
      source: input,
      blockId: "summary",
      replacementBytes: replacement,
    });

    const expectedText = originalText.replace("Existing summary.\r\n", decoder.decode(replacement));
    expect(decoder.decode(result.outputBytes)).toBe(expectedText);
    expect(input.bytes).toEqual(sourceSnapshot);
    expect(replacement).toEqual(replacementSnapshot);
    expect(second).toEqual(result);
    expect(result.artifact).toMatchObject({
      contentHash: sha256(result.candidateBytes),
      byteCount: result.candidateBytes.byteLength,
      candidate: {
        disposition: "review_required",
        writesAllowed: false,
        source: {
          path: "README.md",
          contentHash: input.contentHash,
          byteCount: input.byteCount,
        },
        target: {
          blockId: "summary",
          markerFamily: "lervo_v1",
          contentHash: sha256(encoder.encode("Existing summary.\r\n")),
        },
        replacement: {
          contentHash: sha256(replacement),
          byteCount: replacement.byteLength,
        },
        output: {
          contentHash: sha256(result.outputBytes),
          byteCount: result.outputBytes.byteLength,
        },
        assurances: {
          onlyTargetContentChanged: true,
          markerBytesUnchanged: true,
          outputStructureValid: true,
        },
      },
    });
    expect(JSON.parse(decoder.decode(result.candidateBytes))).toEqual(result.artifact.candidate);
    expect(calculateManagedBlockPatchCandidateId(result.artifact.candidate))
      .toBe(result.artifact.candidate.candidateId);

    const before = parseManagedMarkdownBlocks(input.bytes);
    const after = parseManagedMarkdownBlocks(result.outputBytes);
    expect(after.status).toBe("valid");
    expect(after.blocks.map((block) => [block.blockId, block.markerFamily]))
      .toEqual(before.blocks.map((block) => [block.blockId, block.markerFamily]));
    const beforeTarget = before.blocks.find((block) => block.blockId === "summary");
    const afterTarget = after.blocks.find((block) => block.blockId === "summary");
    expect(result.outputBytes.slice(0, afterTarget?.contentRange.start)).toEqual(
      input.bytes.slice(0, beforeTarget?.contentRange.start),
    );
    expect(result.outputBytes.slice(afterTarget?.contentRange.end)).toEqual(
      input.bytes.slice(beforeTarget?.contentRange.end),
    );
  });

  it("accepts an empty replacement and the exact 8 KiB boundary", () => {
    const input = source("README.md", fixtureSource());
    const empty = createManagedBlockPatchCandidate({
      source: input,
      blockId: "summary",
      replacementBytes: new Uint8Array(),
    });
    expect(empty.artifact.candidate.replacement.byteCount).toBe(0);
    expect(parseManagedMarkdownBlocks(empty.outputBytes).status).toBe("valid");

    const exact = encoder.encode(`${"a".repeat(8191)}\n`);
    const boundary = createManagedBlockPatchCandidate({
      source: input,
      blockId: "summary",
      replacementBytes: exact,
    });
    expect(boundary.artifact.candidate.replacement.byteCount).toBe(8192);
  });

  it.each([
    {
      name: "changed source hash",
      make: () => {
        const input = source("README.md", fixtureSource());
        input.bytes[0] = 0x23;
        return { source: input, blockId: "summary", replacementBytes: encoder.encode("New content\r\n") };
      },
      code: "source_changed",
    },
    {
      name: "invalid source structure",
      make: () => ({
        source: source("README.md", "<!-- lervo:begin block=summary schema=1 -->\n"),
        blockId: "summary",
        replacementBytes: encoder.encode("New content\n"),
      }),
      code: "source_structure_invalid",
    },
    {
      name: "missing block",
      make: () => ({
        source: source("README.md", fixtureSource()),
        blockId: "missing",
        replacementBytes: encoder.encode("New content\r\n"),
      }),
      code: "block_not_found",
    },
    {
      name: "invalid block id",
      make: () => ({
        source: source("README.md", fixtureSource()),
        blockId: "Invalid",
        replacementBytes: encoder.encode("New content\r\n"),
      }),
      code: "invalid_patch_request",
    },
    {
      name: "unsafe source path",
      make: () => ({
        source: source("../README.md", fixtureSource()),
        blockId: "summary",
        replacementBytes: encoder.encode("New content\r\n"),
      }),
      code: "invalid_patch_request",
    },
    {
      name: "repository root source path",
      make: () => ({
        source: source(".", fixtureSource()),
        blockId: "summary",
        replacementBytes: encoder.encode("New content\r\n"),
      }),
      code: "invalid_patch_request",
    },
    {
      name: "invalid UTF-8 replacement",
      make: () => ({
        source: source("README.md", fixtureSource()),
        blockId: "summary",
        replacementBytes: Uint8Array.from([0xff]),
      }),
      code: "replacement_invalid_utf8",
    },
    {
      name: "oversized replacement",
      make: () => ({
        source: source("README.md", fixtureSource()),
        blockId: "summary",
        replacementBytes: new Uint8Array(8193),
      }),
      code: "replacement_too_large",
    },
    {
      name: "unchanged content",
      make: () => ({
        source: source("README.md", fixtureSource()),
        blockId: "summary",
        replacementBytes: encoder.encode("Existing summary.\r\n"),
      }),
      code: "no_changes",
    },
    {
      name: "replacement without a final line ending",
      make: () => ({
        source: source("README.md", fixtureSource()),
        blockId: "summary",
        replacementBytes: encoder.encode("No final newline"),
      }),
      code: "output_structure_invalid",
    },
    {
      name: "replacement that injects a managed marker",
      make: () => ({
        source: source("README.md", fixtureSource()),
        blockId: "summary",
        replacementBytes: encoder.encode([
          "<!-- lervo:begin block=injected schema=1 -->",
          "injected",
          "<!-- lervo:end block=injected -->",
          "",
        ].join("\n")),
      }),
      code: "output_structure_invalid",
    },
  ])("fails closed for $name", ({ make, code }) => {
    expect(() => createManagedBlockPatchCandidate(make())).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("never writes a patch against previous-product markers", () => {
    const legacy = source("README.md", [
      `<!-- ${previousProductPrefix}:begin block=summary schema=1 -->`,
      "legacy content",
      `<!-- ${previousProductPrefix}:end block=summary -->`,
      "",
    ].join("\n"));

    expect(() => createManagedBlockPatchCandidate({
      source: legacy,
      blockId: "summary",
      replacementBytes: encoder.encode("new content\n"),
    })).toThrowError(expect.objectContaining({ code: "legacy_marker_not_writable" }));
  });
});
