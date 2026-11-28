import { describe, expect, it } from "vitest";

import { discloseLifecyclePlanMoves } from "../src/lifecycle-plan-move-disclosure.js";

const large = `# Planned work\n\n${Array.from({ length: 4_000 }, (_, index) => `- item ${index} [spec](../specs/a.md)`).join("\n")}\n`;

describe("moved documents in a plan review", () => {
  it("binds a byte-identical move by hash, without the document's bytes", () => {
    const plan = {
      operations: [
        { path: "docs/planned.md", destinationPath: "docs/work/planned.md", action: "move" },
      ],
    };
    const sources = [
      { path: "docs/planned.md", contentHash: "sha256:a", content: large },
      { path: "docs/work/planned.md", contentHash: null, content: null },
    ];
    const disclosed = discloseLifecyclePlanMoves(plan, sources);
    expect(disclosed.plan).toBe(plan);
    expect(disclosed.sources[0]).toEqual({
      path: "docs/planned.md",
      contentHash: "sha256:a",
      content: null,
      movedTo: "docs/work/planned.md",
    });
    expect(disclosed.sources[1]).toBe(sources[1]);
  });

  it("shows a rewriting move as its rewritten lines, and keeps bytes for anything else", () => {
    const rewritten = large.replace(
      "- item 7 [spec](../specs/a.md)",
      "- item 7 [spec](../../specs/a.md)",
    );
    const plan = {
      operations: [
        {
          path: "docs/planned.md",
          destinationPath: "docs/work/planned.md",
          action: "move_update",
          content: rewritten,
        },
        {
          path: "docs/other.md",
          destinationPath: "docs/work/other.md",
          action: "move_update",
          content: "# Other\n\nRewritten entirely.\nWith another line.\n",
        },
      ],
    };
    const disclosed = discloseLifecyclePlanMoves(plan, [
      { path: "docs/planned.md", contentHash: "sha256:a", content: large },
      { path: "docs/other.md", contentHash: "sha256:b", content: "# Other\n\nOld.\n" },
    ]);
    expect(disclosed.sources[0]).toMatchObject({
      content: null,
      movedTo: "docs/work/planned.md",
      rewrittenLines: [
        {
          line: 10,
          before: "- item 7 [spec](../specs/a.md)",
          after: "- item 7 [spec](../../specs/a.md)",
        },
      ],
    });
    // A rewrite that changes the line count is shown whole, as before.
    expect(disclosed.sources[1]).toMatchObject({ content: "# Other\n\nOld.\n" });
    const operations = (disclosed.plan as { operations: Array<Record<string, unknown>> })
      .operations;
    expect(operations[0]).not.toHaveProperty("content");
    expect(operations[0]).toMatchObject({
      contentDisclosed: false,
      rewrittenLinesOf: "docs/planned.md",
    });
    expect(operations[1]).toHaveProperty("content");
    expect(Buffer.byteLength(JSON.stringify(disclosed))).toBeLessThan(
      Buffer.byteLength(large) / 10,
    );
  });

  it("bounds a rewritten line to its changed span, however long the line is", () => {
    const row = `| ${"cell ".repeat(20_000)}[spec](../specs/a.md) ${"tail ".repeat(20_000)}|`;
    const moved = row.replace("](../specs/a.md)", "](../../specs/a.md)");
    const disclosed = discloseLifecyclePlanMoves(
      {
        operations: [
          {
            path: "docs/t.md",
            destinationPath: "docs/x/t.md",
            action: "move_update",
            content: moved,
          },
        ],
      },
      [{ path: "docs/t.md", contentHash: "sha256:t", content: row }],
    );
    const [line] = (disclosed.sources[0] as { rewrittenLines: Array<Record<string, unknown>> })
      .rewrittenLines;
    expect(line).toMatchObject({ line: 1 });
    expect(String(line!.before).length).toBeLessThan(200);
    expect(String(line!.after)).toContain("](../../specs/a.md)");
    expect(Number(line!.column)).toBeGreaterThan(90_000);
  });
});
