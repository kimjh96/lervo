import { describe, expect, it } from "vitest";

import { parseManagedMarkdownBlocks } from "../src/index.js";

const encoder = new TextEncoder();
const previousProductPrefix = "ro" + "ven";

function byteOffset(source: string, characterOffset: number): number {
  return Buffer.byteLength(source.slice(0, characterOffset));
}

function bytes(source: string): Uint8Array {
  return encoder.encode(source);
}

describe("managed Markdown block parser", () => {
  it("returns exact UTF-8 byte ownership ranges for Korean text and CRLF", () => {
    const startMarker = "<!-- lervo:begin block=summary schema=1 -->";
    const endMarker = "<!-- lervo:end block=summary -->";
    const content = "관리되는 요약입니다.\r\n";
    const source = `사람이 쓴 머리말입니다.\r\n\r\n${startMarker}\r\n${content}${endMarker}\r\n\r\n사람이 쓴 꼬리말입니다.\r\n`;
    const original = bytes(source);
    const snapshot = original.slice();

    const result = parseManagedMarkdownBlocks(original);

    const startCharacter = source.indexOf(startMarker);
    const contentCharacter = startCharacter + startMarker.length + 2;
    const endCharacter = source.indexOf(endMarker);
    const fullEndCharacter = endCharacter + endMarker.length + 2;
    expect(result).toMatchObject({
      status: "valid",
      byteCount: original.byteLength,
      diagnostics: [],
      blocks: [{
        blockId: "summary",
        markerFamily: "lervo_v1",
        startMarkerRange: {
          start: byteOffset(source, startCharacter),
          end: byteOffset(source, startCharacter + startMarker.length),
        },
        contentRange: {
          start: byteOffset(source, contentCharacter),
          end: byteOffset(source, endCharacter),
        },
        endMarkerRange: {
          start: byteOffset(source, endCharacter),
          end: byteOffset(source, endCharacter + endMarker.length),
        },
        fullRange: {
          start: byteOffset(source, startCharacter),
          end: byteOffset(source, fullEndCharacter),
        },
      }],
      unmanagedRanges: [
        { start: 0, end: byteOffset(source, startCharacter) },
        { start: byteOffset(source, fullEndCharacter), end: original.byteLength },
      ],
    });
    expect(original).toEqual(snapshot);
    const block = result.blocks[0];
    expect(block).toBeDefined();
    expect(new TextDecoder().decode(original.slice(block?.contentRange.start, block?.contentRange.end)))
      .toBe(content);
  });

  it("preserves a UTF-8 byte-order mark and recognizes CommonMark CR line endings", () => {
    const source = [
      "\uFEFF<!-- lervo:begin block=bom schema=1 -->",
      "한글 내용",
      "<!-- lervo:end block=bom -->",
      "사용자 꼬리말",
    ].join("\r");
    const input = bytes(source);

    const result = parseManagedMarkdownBlocks(input);

    const markerStart = source.indexOf("<!-- lervo:begin");
    const endMarker = source.indexOf("<!-- lervo:end");
    const endMarkerEnd = source.indexOf("-->", endMarker) + 3;
    expect(result).toMatchObject({
      status: "valid",
      blocks: [{
        blockId: "bom",
        fullRange: {
          start: byteOffset(source, markerStart),
          end: byteOffset(source, endMarkerEnd + 1),
        },
      }],
      unmanagedRanges: [
        { start: 0, end: 3 },
        { start: byteOffset(source, endMarkerEnd + 1), end: input.byteLength },
      ],
    });
  });

  it("ignores marker-shaped text in fenced, indented, and inline code", () => {
    const source = [
      "# 예제",
      "",
      "```md",
      "<!-- lervo:begin block=fenced schema=1 -->",
      "<!-- lervo:end block=fenced -->",
      "```",
      "",
      "    <!-- lervo:begin block=indented schema=1 -->",
      "    <!-- lervo:end block=indented -->",
      "",
      "`<!-- lervo:begin block=inline schema=1 -->`",
      "",
    ].join("\n");

    const result = parseManagedMarkdownBlocks(bytes(source));

    expect(result.status).toBe("valid");
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.ignoredMarkers.map((marker) => marker.reason)).toEqual([
      "code_block",
      "code_block",
      "code_block",
      "code_block",
      "inline_code",
    ]);
    expect(result.unmanagedRanges).toEqual([{ start: 0, end: bytes(source).byteLength }]);
  });

  it("recognizes the previous marker family without treating it as writable output", () => {
    const source = [
      `<!-- ${previousProductPrefix}:begin block=context schema=1 -->`,
      "legacy content",
      `<!-- ${previousProductPrefix}:end block=context -->`,
      "",
    ].join("\n");

    const result = parseManagedMarkdownBlocks(bytes(source));

    expect(result.status).toBe("valid");
    expect(result.blocks).toMatchObject([{ blockId: "context", markerFamily: "previous_product_v1" }]);
  });

  it.each([
    {
      name: "nested begin",
      source: [
        "<!-- lervo:begin block=outer schema=1 -->",
        "<!-- lervo:begin block=inner schema=1 -->",
        "<!-- lervo:end block=outer -->",
      ].join("\n"),
      code: "nested_begin_marker",
    },
    {
      name: "duplicate block id",
      source: [
        "<!-- lervo:begin block=same schema=1 -->",
        "one",
        "<!-- lervo:end block=same -->",
        "<!-- lervo:begin block=same schema=1 -->",
        "two",
        "<!-- lervo:end block=same -->",
      ].join("\n"),
      code: "duplicate_block_id",
    },
    {
      name: "mismatched end",
      source: [
        "<!-- lervo:begin block=one schema=1 -->",
        "<!-- lervo:end block=two -->",
      ].join("\n"),
      code: "mismatched_end_marker",
    },
    {
      name: "unexpected end",
      source: "<!-- lervo:end block=orphan -->\n",
      code: "unexpected_end_marker",
    },
    {
      name: "unclosed begin",
      source: "<!-- lervo:begin block=open schema=1 -->\n",
      code: "unclosed_begin_marker",
    },
    {
      name: "non-standalone marker",
      source: "prefix <!-- lervo:begin block=inline schema=1 -->\n",
      code: "marker_not_standalone",
    },
    {
      name: "invalid syntax",
      source: "<!-- lervo:begin block=UPPER schema=1 -->\n",
      code: "invalid_marker_syntax",
    },
    {
      name: "marker nested in an HTML block",
      source: [
        "<div>",
        "<!-- lervo:begin block=nested_html schema=1 -->",
        "content",
        "<!-- lervo:end block=nested_html -->",
        "</div>",
      ].join("\n"),
      code: "marker_not_commonmark_html",
    },
  ])("fails closed for $name", ({ source, code }) => {
    const result = parseManagedMarkdownBlocks(bytes(source));

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    expect(result.unmanagedRanges).toEqual([]);
  });

  it("rejects mixed canonical and previous marker families", () => {
    const source = [
      "<!-- lervo:begin block=current schema=1 -->",
      "current",
      "<!-- lervo:end block=current -->",
      `<!-- ${previousProductPrefix}:begin block=old schema=1 -->`,
      "old",
      `<!-- ${previousProductPrefix}:end block=old -->`,
    ].join("\n");

    const result = parseManagedMarkdownBlocks(bytes(source));

    expect(result.status).toBe("invalid");
    expect(result.diagnostics).toContainEqual({ code: "mixed_marker_families" });
  });

  it("enforces input and managed-content byte limits", () => {
    const exactBlock = [
      "<!-- lervo:begin block=exact schema=1 -->",
      "a".repeat(8191),
      "<!-- lervo:end block=exact -->",
    ].join("\n");
    expect(parseManagedMarkdownBlocks(bytes(exactBlock))).toMatchObject({
      status: "valid",
      diagnostics: [],
    });

    const oversizedBlock = [
      "<!-- lervo:begin block=large schema=1 -->",
      "가".repeat(2731),
      "<!-- lervo:end block=large -->",
    ].join("\n");
    expect(parseManagedMarkdownBlocks(bytes(oversizedBlock)).diagnostics)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "managed_block_too_large" })]));

    const oversizedInput = new Uint8Array(4 * 1024 * 1024 + 1);
    expect(parseManagedMarkdownBlocks(oversizedInput)).toMatchObject({
      status: "invalid",
      diagnostics: [{ code: "input_too_large" }],
    });
    expect(parseManagedMarkdownBlocks(Uint8Array.from([0xff]))).toMatchObject({
      status: "invalid",
      diagnostics: [{ code: "invalid_utf8" }],
    });
  });

  it("bounds marker candidate scanning before structural pairing", () => {
    const source = Array.from(
      { length: 257 },
      (_, index) => `<!-- lervo:end block=block_${index} -->`,
    ).join("\n");

    expect(parseManagedMarkdownBlocks(bytes(source))).toMatchObject({
      status: "invalid",
      blocks: [],
      diagnostics: [{ code: "too_many_markers" }],
    });
  });
});
