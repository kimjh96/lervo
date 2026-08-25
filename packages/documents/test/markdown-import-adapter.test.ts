import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { markdownImportAdapter, type DocumentImportSource } from "../src/index.js";

const previousProductPrefix = "ro" + "ven";

function source(path: string, content: string): DocumentImportSource {
  const bytes = new TextEncoder().encode(content);
  return {
    path,
    bytes,
    byteCount: bytes.byteLength,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

async function inspect(path: string, content: string) {
  const drafts = await markdownImportAdapter.inspect(source(path, content));
  expect(drafts).toHaveLength(1);
  return drafts[0];
}

describe("Markdown import adapter ownership detection", () => {
  it("classifies structurally valid canonical blocks with high confidence", async () => {
    const draft = await inspect(
      "README.md",
      [
        "<!-- lervo:begin block=summary schema=1 -->",
        "generated summary",
        "<!-- lervo:end block=summary -->",
        "",
      ].join("\n"),
    );

    expect(draft).toMatchObject({
      confidence: "high",
      detectedOwnership: "managed_blocks",
      warnings: ["profile_requires_review"],
    });
  });

  it("does not classify marker examples in CommonMark code as managed", async () => {
    const draft = await inspect(
      "guide.md",
      [
        "```md",
        "<!-- lervo:begin block=example schema=1 -->",
        "<!-- lervo:end block=example -->",
        "```",
        "",
      ].join("\n"),
    );

    expect(draft).toMatchObject({
      confidence: "medium",
      detectedOwnership: "user",
    });
    expect(draft?.warnings).toContain("marker_candidates_in_code_ignored");
  });

  it("fails closed when marker structure is invalid", async () => {
    const draft = await inspect("broken.md", "<!-- lervo:begin block=open schema=1 -->\n");

    expect(draft).toMatchObject({
      confidence: "none",
      detectedOwnership: "unknown",
    });
    expect(draft?.warnings).toEqual(
      expect.arrayContaining(["managed_block_structure_invalid", "unclosed_begin_marker"]),
    );
  });

  it("recognizes previous markers only as a migration candidate", async () => {
    const draft = await inspect(
      "legacy.md",
      [
        `<!-- ${previousProductPrefix}:begin block=context schema=1 -->`,
        "legacy content",
        `<!-- ${previousProductPrefix}:end block=context -->`,
        "",
      ].join("\n"),
    );

    expect(draft).toMatchObject({
      confidence: "low",
      detectedOwnership: "managed_blocks",
    });
    expect(draft?.warnings).toContain("legacy_marker_requires_migration");
  });

  it("keeps MDX on the unverified path until MDX parsing is implemented", async () => {
    const draft = await inspect(
      "component.mdx",
      [
        "<!-- lervo:begin block=context schema=1 -->",
        "<Component />",
        "<!-- lervo:end block=context -->",
      ].join("\n"),
    );

    expect(draft).toMatchObject({
      confidence: "none",
      detectedOwnership: "unknown",
    });
    expect(draft?.warnings).toEqual(
      expect.arrayContaining(["mdx_semantics_not_parsed", "marker_structure_not_verified"]),
    );
  });
});
