import { expect, it } from "vitest";
import { transcriptSkillIdentifiers } from "../src/terminal-skill-transcript-adapters.js";

const native = {
  claude: {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "eli5" } }] },
  },
  codex: {
    type: "response_item",
    payload: { type: "function_call", name: "Skill", arguments: JSON.stringify({ skill: "eli5" }) },
  },
};

it.each(["claude", "codex"] as const)(
  "%s accepts native invocation evidence and ignores plain text and tool output",
  (provider) => {
    expect(transcriptSkillIdentifiers(provider, native[provider])).toEqual(["eli5"]);
    for (const entry of [
      null,
      { type: "user", message: native.claude.message },
      { type: "assistant", message: { content: [{ type: "text", text: "Skill eli5" }] } },
      {
        type: "response_item",
        payload: { type: "function_call_output", output: native.codex.payload },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "cat .agents/skills/eli5/SKILL.md" }),
        },
      },
    ]) {
      expect(transcriptSkillIdentifiers(provider, entry)).toEqual([]);
    }
  },
);
