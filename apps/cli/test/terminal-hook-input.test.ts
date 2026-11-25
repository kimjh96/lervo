import { expect, it } from "vitest";

import { parseTerminalHookInput } from "../src/terminal-hook-input.js";

const prompt = (text: unknown) =>
  JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: text });

it("accepts a prompt with no text, as an image-only message sends (ADR-0635)", () => {
  expect(parseTerminalHookInput(prompt("")).prompt).toBe("");
  expect(parseTerminalHookInput(prompt("  \n")).prompt).toBe("  \n");
});

it("cuts a long prompt to the bound instead of refusing it, never inside a surrogate pair", () => {
  expect(parseTerminalHookInput(prompt("a".repeat(70_000))).prompt).toHaveLength(64 * 1024);
  // The 65,536th code unit would be the first half of an emoji; the cut drops it.
  const text = `${"a".repeat(64 * 1024 - 1)}😀tail`;
  const cut = parseTerminalHookInput(prompt(text)).prompt!;
  expect(cut).toHaveLength(64 * 1024 - 1);
  expect(cut.endsWith("a")).toBe(true);
});

it("still refuses a prompt hook with no prompt field", () => {
  expect(() =>
    parseTerminalHookInput(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s" }),
    ),
  ).toThrow("The prompt is missing.");
});
