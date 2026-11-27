import { describe, expect, it } from "vitest";

import { RECALLED_NOTE_BYTES, recalledNotes } from "../src/room-context.js";

describe("the notes an agent's session recalls", () => {
  it("names the three newest of its own conversation notes, and nothing else it learned", () => {
    const entry = (kind: string, summary: string | null) => ({ kind, summary });
    expect(
      recalledNotes([
        entry("conversation_note", "Retries use a 2 s default."),
        entry("expertise", "Retry-After is in seconds."),
        entry("conversation_note", null),
        entry("conversation_note", "The budget is 5 attempts."),
        entry("conversation_note", "Iris owns the sandbox."),
        entry("conversation_note", "An older note."),
      ]),
    ).toEqual([
      "- Retries use a 2 s default.",
      "- The budget is 5 attempts.",
      "- Iris owns the sandbox.",
    ]);
    expect(recalledNotes([])).toEqual([]);
  });
});

describe("the recall's bounds", () => {
  it("keeps the recalled notes within their bytes, cutting each at a word", () => {
    const wide = (character: string) => ({
      kind: "conversation_note",
      summary: `${character.repeat(20)} `.repeat(40),
    });
    const lines = recalledNotes([wide("가"), wide("나"), wide("다")]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(3);
    expect(Buffer.byteLength(lines.join("\n"))).toBeLessThanOrEqual(RECALLED_NOTE_BYTES);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(2 + 512);
  });
});
