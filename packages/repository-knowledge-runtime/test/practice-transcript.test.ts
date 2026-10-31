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

describe("Codex command sessions", () => {
  function call(id: string, name: string, input: Record<string, unknown>) {
    return {
      type: "response_item",
      payload: { type: "function_call", call_id: id, name, arguments: JSON.stringify(input) },
    };
  }
  function result(id: string, output: unknown) {
    return {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: id,
        output: typeof output === "string" ? output : JSON.stringify(output),
      },
    };
  }
  it.each(["structured", "native_text"])(
    "attributes only the final %s session exit to its original command",
    (format) => {
      const entries = [
        call("first", "exec_command", { cmd: "pnpm typecheck" }),
        result(
          "first",
          format === "structured" ? { session_id: 101 } : "Process running with session ID 101",
        ),
        call("second", "exec_command", { cmd: "pnpm build" }),
        result("second", { session_id: 202 }),
        call("poll-one", "write_stdin", { session_id: 101, chars: "" }),
        result("poll-one", { session_id: 101 }),
        call("finish-two", "write_stdin", { session_id: 202, chars: "" }),
        result("finish-two", { exit_code: 1 }),
        call("finish-one", "write_stdin", { session_id: 101, chars: "" }),
        result(
          "finish-one",
          format === "structured" ? { exit_code: 0 } : "Process exited with code 0",
        ),
      ];
      const interim = extractPracticeSteps(entries.slice(0, 6), "/repo");
      expect(interim.steps[0]!.outcome).toBe("unknown");
      const complete = extractPracticeSteps(entries, "/repo");
      expect(complete.steps[0]).toMatchObject({ verification: true, outcome: "passed" });
      expect(complete.steps[1]).toMatchObject({ verification: true, outcome: "failed" });
      expect(complete.steps[2]!.outcome).toBe("unknown");
      expect(JSON.stringify(complete)).not.toContain("session_id");
    },
  );
  it("leaves a running or unknown session unverified", () => {
    const extracted = extractPracticeSteps(
      [
        call("start", "exec_command", { cmd: "pnpm check" }),
        result("start", { session_id: 101 }),
        call("unrelated", "write_stdin", { session_id: 999, chars: "" }),
        result("unrelated", { exit_code: 0 }),
      ],
      "/repo",
    );
    expect(extracted.steps[0]!.outcome).toBe("unknown");
  });
});
