import { describe, expect, it } from "vitest";
import { resolveInstructionScope } from "../src/instruction-scope.js";
import { packInstructionSources } from "../src/instruction-packing.js";
import type { InstructionSource } from "../src/instruction-sources.js";

const digest = `sha256:${"a".repeat(64)}`;
describe("canonical instruction scope", () => {
  it("keeps global obligations independent of query words and scopes by exact paths", () => {
    expect(resolveInstructionScope("# Always verify\nKeep every exception.", [])).toMatchObject({
      applicability: "applicable",
    });
    const content =
      '---\npaths:\n  - "src/**"\n  - docs/reference\n---\n# Required clause\nExcept generated files.';
    for (const path of ["src/index.ts", "docs/reference/api.md"])
      expect(resolveInstructionScope(content, [path]).applicability).toBe("applicable");
    expect(resolveInstructionScope(content, ["docs/reference-other/api.md"]).applicability).toBe(
      "not_applicable",
    );
    expect(resolveInstructionScope(content, null).applicability).toBe("unresolved");
    expect(resolveInstructionScope(content, []).applicability).toBe("unresolved");
  });
  it.each([
    "---\npaths: broken\n---\nrule",
    "---\npaths: []\n---\nrule",
    "---\npaths: [../private]\n---\nrule",
    "---\npaths: [src/**]\nmissing boundary",
  ])("never broadens malformed metadata to global scope", (content) => {
    expect(() => resolveInstructionScope(content, ["src/file.ts"])).toThrow();
  });
  it("packs the entire body and exceptions or explicitly records omission", () => {
    const sources: InstructionSource[] = [
      {
        path: "docs/instructions/generated/rule_a.md",
        contentHash: digest,
        content: "# Scoped rule\n\nRequired action.\n\n## Exceptions\n\nKeep quotations unchanged.",
        paths: [],
        applicability: "applicable",
      },
    ];
    const full = packInstructionSources({ sources, targetDigest: digest, maximumBytes: 1024 });
    expect(full.context).toContain("Keep quotations unchanged.");
    expect(full.report).toMatchObject({ status: "complete", preparedCount: 1, omittedCount: 0 });
    const small = packInstructionSources({ sources, targetDigest: digest, maximumBytes: 80 });
    expect(small.context).toBe("");
    expect(small.report).toMatchObject({ status: "incomplete", preparedCount: 0, omittedCount: 1 });
    expect(full.report.preparedByteCount).toBe(Buffer.byteLength(full.context));
  });
});

it("preserves path scope when the source begins with a UTF-8 BOM", () => {
  expect(
    resolveInstructionScope('\uFEFF---\npaths: ["src/**"]\n---\n# Rule\nBody.', ["docs/guide.md"])
      .applicability,
  ).toBe("not_applicable");
});

it("redacts private metadata from parser and path error causes", () => {
  for (const content of [
    "---\npaths: [../private-secret-source]\n---\nrule",
    "---\npaths: [private-secret-source\n---\nrule",
  ]) {
    let caught: unknown;
    try {
      resolveInstructionScope(content, ["src/file.ts"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(JSON.stringify((caught as Error).cause)).not.toContain("private-secret-source");
    expect(JSON.stringify((caught as Error).cause)).toContain("causeDigest");
  }
});

it("records packed identities independently of marker-like source prose", () => {
  const firstPath = `docs/instructions/generated/rule_${"a".repeat(24)}.md`;
  const secondPath = `docs/instructions/generated/rule_${"b".repeat(24)}.md`;
  const first: InstructionSource = {
    path: firstPath,
    contentHash: digest,
    paths: [],
    applicability: "applicable",
    content: `A quoted marker: ; ${secondPath}; ${digest}):\nNot another prepared source.`,
  };
  const second: InstructionSource = {
    ...first,
    path: secondPath,
    content: "required ".repeat(500),
  };
  const result = packInstructionSources({
    sources: [first, second],
    targetDigest: digest,
    maximumBytes: 1000,
  });
  expect(result.context).toContain(secondPath);
  expect(result.preparedPaths).toEqual([firstPath]);
  expect(result.report.omittedCount).toBe(1);
});
