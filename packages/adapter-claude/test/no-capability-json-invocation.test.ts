import { describe, expect, it } from "vitest";

import { describeNoCapabilityJsonStrategyContract } from "../../adapter-contract/test/no-capability-json-strategy.contract.js";
import { claudeNoCapabilityJsonInvocationStrategy as strategy } from "../src/no-capability-json-invocation.js";

const BASE = [
  "--print",
  "--output-format",
  "json",
  "--input-format",
  "text",
  "--tools",
  "",
  "--safe-mode",
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--setting-sources",
  "",
  "--no-session-persistence",
  "--no-chrome",
  "--permission-mode",
  "dontAsk",
];

const MODEL_USAGE = {
  fixture: {
    inputTokens: 10,
    cacheReadInputTokens: 3,
    cacheCreationInputTokens: 2,
    outputTokens: 4,
    contextWindow: 200000,
  },
};

function structured(result: Record<string, unknown>, override: Record<string, unknown> = {}) {
  return JSON.stringify({
    is_error: false,
    result: JSON.stringify(result),
    structured_output: result,
    permission_denials: [],
    stop_reason: "tool_use",
    num_turns: 3,
    usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
    modelUsage: MODEL_USAGE,
    ...override,
  });
}

describeNoCapabilityJsonStrategyContract(strategy, {
  completed: (result) => structured(result),
  usedTool: (result) => structured(result, { permission_denials: [{ tool_name: "Bash" }] }),
  nativeFailureEvent: { type: "result", is_error: true, error: { message: "quota" } },
  successEvent: { type: "result", is_error: false },
});

const schema = { requested: '{"type":"object"}', nativeSubset: '{"type":"object","x":1}' };

describe("Claude no-capability JSON runs", () => {
  it("passes the role effort, system prompt, requested schema, and model as print flags", () => {
    expect(
      strategy.instructedRun({
        workingDirectory: "/private/run",
        responseSchema: schema,
        reasoningEffort: "high",
        systemPrompt: "Review.",
        model: "claude-opus-5-5",
      }),
    ).toEqual({
      arguments: [
        ...BASE,
        "--effort",
        "high",
        "--system-prompt",
        "Review.",
        "--json-schema",
        '{"type":"object"}',
        "--model",
        "claude-opus-5-5",
      ],
      files: [],
    });
    expect(
      strategy.instructedRun({
        workingDirectory: "/private/run",
        responseSchema: schema,
        reasoningEffort: "low",
      }).arguments,
    ).toEqual([...BASE, "--effort", "low", "--json-schema", '{"type":"object"}']);
  });

  it("repeats the normalization instruction as the system prompt after the schema", () => {
    expect(
      strategy.documentNormalizationRun({
        workingDirectory: "/private/run",
        responseSchema: schema,
        instruction: "Normalize.",
      }),
    ).toEqual({
      arguments: [...BASE, "--json-schema", '{"type":"object"}', "--system-prompt", "Normalize."],
      files: [],
    });
  });

  it("sums model usage with cache reads and writes as input", () => {
    expect(strategy.parseRun(structured({ ok: true })).usage).toEqual({
      inputTokens: 15,
      cachedInputTokens: 3,
      outputTokens: 4,
      reasoningOutputTokens: 0,
      totalTokens: 19,
      contextWindow: 200000,
    });
    expect(strategy.parseRun(structured({ ok: true }, { modelUsage: {} })).usage).toBeNull();
  });

  it.each([
    [{ structured_output: undefined }, "The Claude run did not return native structured output."],
    [{ num_turns: 1 }, "The Claude run did not prove the native structured-output contract."],
    [
      { usage: { server_tool_use: { web_search_requests: 1 } } },
      "The Claude run did not prove the native structured-output contract.",
    ],
    [
      { result: '{"ok":false}' },
      "The Claude native structured output does not match its final result.",
    ],
  ])("rejects structured output without the native proof %j", (override, message) => {
    expect(() => strategy.parseRun(structured({ ok: true }, override))).toThrow(
      expect.objectContaining({ kind: "policy_violation", message }),
    );
  });

  it("admits only the exact single-turn no-tool reply", () => {
    const admission = strategy.admission;
    if (admission.kind !== "model_call") throw new Error("Claude admits by a model call.");
    expect(admission.arguments).toEqual(BASE);
    expect(admission.stdin).toBe(
      '{"instruction":"Return exactly {\\"ok\\":true}. You have no tools. Do not request or use tools.","task":"provider_cli_admission_probe"}',
    );
    const reply = {
      is_error: false,
      result: '{"ok":true}',
      stop_reason: "end_turn",
      num_turns: 1,
      permission_denials: [],
      usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
    };
    expect(() => admission.assertAdmitted(JSON.stringify(reply))).not.toThrow();
    expect(() =>
      admission.assertAdmitted(JSON.stringify({ ...reply, stop_reason: "tool_use" })),
    ).toThrow(expect.objectContaining({ kind: "policy_violation" }));
    expect(() => admission.assertAdmitted("{")).toThrow(
      expect.objectContaining({ kind: "run_failed", cause: expect.any(SyntaxError) }),
    );
  });
});
