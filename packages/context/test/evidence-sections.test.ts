import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { selectEvidenceSections } from "../src/evidence-sections.js";
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const pick = (text: string, maximumBytes = 700) => {
  const bytes = Buffer.from(text);
  return selectEvidenceSections({
    bytes,
    expectedHash: hash(bytes),
    query: "cancellation",
    maximumBytes,
  });
};
describe("exact evidence sections", () => {
  it("finds the operative tail clause and retains definitions, nested exceptions and ancestors", () => {
    const text =
      "# Runtime\nOverview.\n## Definitions\nWaiter means consumer.\n## Background\n" +
      "irrelevant ".repeat(300) +
      "\n## Cancellation\nStop only detached consumers.\n## Exceptions\n### Shared tasks\nPreserve another waiter.\n";
    const result = pick(text)!;
    expect(result.content).toContain("Stop only detached consumers.");
    expect(result.content).toContain("Waiter means consumer.");
    expect(result.content).toContain("Preserve another waiter.");
    expect(result.content).not.toContain("irrelevant");
    for (const section of result.sections)
      expect(hash(Buffer.from(text).subarray(section.byteStart, section.byteEnd))).toBe(
        section.sectionHash,
      );
  });
  it("ignores headings in fenced code and preserves UTF-8 BOM/ranges", () => {
    const text =
      "\uFEFF# Runtime\n도입.\n## Noise\n" +
      "filler ".repeat(300) +
      "\n## Cancellation\n```md\n# not a heading\n```\n취소 조건.\n";
    const result = pick(text)!;
    expect(result.content).toContain("```md\n# not a heading\n```");
    expect(result.content).toContain("취소 조건.");
    expect(result.content.startsWith("\uFEFF")).toBe(true);
    for (const section of result.sections)
      expect(hash(Buffer.from(text).subarray(section.byteStart, section.byteEnd))).toBe(
        section.sectionHash,
      );
  });
  it("refuses partial clauses and changed or invalid source bytes", () => {
    expect(pick("# Runtime\n## Cancellation\n" + "mandatory ".repeat(500), 200)).toBeNull();
    expect(() =>
      selectEvidenceSections({
        bytes: Buffer.from("changed"),
        expectedHash: hash(Buffer.from("original")),
        query: "changed",
        maximumBytes: 100,
      }),
    ).toThrow();
    const invalid = new Uint8Array([0xff]);
    expect(() =>
      selectEvidenceSections({
        bytes: invalid,
        expectedHash: hash(invalid),
        query: "x",
        maximumBytes: 100,
      }),
    ).toThrow();
  });
  it("does not label a relevance miss as an empty corpus", () => {
    expect(pick("# Other\n" + "other ".repeat(1000))).toBeNull();
  });
});
