import { describe, expect, it } from "vitest";
import { extractPracticeSteps } from "../src/practice-transcript.js";

describe.each(["claude", "codex"] as const)("%s completed-work adapter contract", (provider) => {
  function entries(code?: number) {
    return provider === "claude"
      ? [
          {
            uuid: "call",
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "step",
                  name: "Bash",
                  input: { command: "/usr/bin/pnpm check --private-argument value" },
                },
              ],
            },
          },
          {
            uuid: "result",
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "step",
                  ...(code === undefined ? {} : { is_error: code !== 0 }),
                },
              ],
            },
          },
        ]
      : [
          {
            type: "response_item",
            payload: {
              type: "function_call",
              call_id: "step",
              name: "exec_command",
              arguments: JSON.stringify({ cmd: "/usr/bin/pnpm check --private-argument value" }),
            },
          },
          {
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "step",
              output: JSON.stringify(code === undefined ? {} : { exit_code: code }),
            },
          },
        ];
  }
  it.each([0, 1, undefined])(
    "keeps recorded exit status %s distinct from an unobserved outcome",
    (code) => {
      const result = extractPracticeSteps(entries(code), "/repo");
      expect(result.steps[0]!.outcome).toBe(
        code === undefined ? "unknown" : code === 0 ? "passed" : "failed",
      );
      expect(result.steps[0]!.executable).toBe("pnpm");
      expect(JSON.stringify(result)).not.toContain("private-argument");
      expect(result.complete).toBe(true);
    },
  );
});

it.each(["echo test", "pnpm test || true", "pnpm test --help"])(
  "does not infer verification from %s",
  (command) => {
    const result = extractPracticeSteps(
      [
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "call", name: "Bash", input: { command } }],
          },
        },
      ],
      "/repo",
    );
    expect(result.steps[0]!.verification).toBe(false);
  },
);
