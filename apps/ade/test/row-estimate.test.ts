import { describe, expect, it } from "vitest";

import { estimatedRowHeight } from "../src/features/conversation/view/row-estimate";

const reply = (text: string) =>
  ({ kind: "agent_message", itemId: "i1", text }) as Parameters<typeof estimatedRowHeight>[0];

describe("a row's estimated height", () => {
  it("counts a code block and a table by their own rows, not as wrapped prose", () => {
    const code = [
      "```ts",
      ...Array.from({ length: 10 }, (_, line) => `const a${line} = 1;`),
      "```",
    ];
    // A padded block of ten 17.5 px lines, and the row's own padding.
    expect(estimatedRowHeight(reply(code.join("\n")))).toBe(20 + 24 + 175);
    const table = ["| Step | Tool |", "|---|---|", "| 0 | Read |", "| 1 | Grep |"];
    // Three rendered rows; the rule row renders nothing.
    expect(estimatedRowHeight(reply(table.join("\n")))).toBe(20 + 90);
  });

  it("wraps prose at the column and leaves a gap between paragraphs", () => {
    expect(estimatedRowHeight(reply(`${"a".repeat(180)}\n\nShort.`))).toBe(20 + 50 + 12 + 25);
  });
});
