import { describe, expect, it, vi } from "vitest";

import { describeNoCapabilityJsonStrategyContract } from "../../adapter-contract/test/no-capability-json-strategy.contract.js";
import { codexNoCapabilityJsonInvocationStrategy as strategy } from "../src/no-capability-json-invocation.js";

const BASE = [
  "exec",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  "--ephemeral",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--json",
  "-c",
  "mcp_servers={}",
];
const FEATURES = [
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "apps",
  "plugins",
  "multi_agent",
  "image_generation",
  "view_image",
  "goals",
  "hooks",
  "tool_suggest",
  "workspace_dependencies",
  "auth_elicitation",
  "guardian_approval",
  "tool_call_mcp_elicitation",
];
const DISABLE = FEATURES.flatMap((feature) => ["--disable", feature]);

function events(...items: Array<Record<string, unknown>>): string {
  return items.map((item) => JSON.stringify(item)).join("\n");
}

const USAGE = {
  type: "turn.completed",
  usage: { input_tokens: 15, cached_input_tokens: 3, output_tokens: 4, reasoning_output_tokens: 1 },
};

function completed(result: Record<string, unknown>, ...before: Array<Record<string, unknown>>) {
  return events(
    { type: "thread.started" },
    { type: "turn.started" },
    ...before,
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(result) } },
    USAGE,
  );
}

describeNoCapabilityJsonStrategyContract(strategy, {
  completed: (result) => completed(result),
  usedTool: (result) =>
    completed(result, { type: "item.completed", item: { type: "command_execution" } }),
  nativeFailureEvent: { type: "turn.failed", error: { message: "quota" } },
  successEvent: { type: "item.completed" },
});

const schema = { requested: '{"type":"object","x":1}', nativeSubset: '{"type":"object"}' };

describe("Codex no-capability JSON runs", () => {
  it("passes effort and developer instructions as config and the native schema as a file", () => {
    expect(
      strategy.instructedRun({
        workingDirectory: "/private/run",
        responseSchema: schema,
        reasoningEffort: "high",
        systemPrompt: 'Review "this".',
        model: "gpt-6",
      }),
    ).toEqual({
      arguments: [
        ...BASE,
        "-c",
        'model_reasoning_effort="high"',
        "-c",
        'developer_instructions="Review \\"this\\"."',
        "--output-schema",
        "/private/run/response-schema.json",
        ...DISABLE,
        "--model",
        "gpt-6",
        "-",
      ],
      files: [{ path: "/private/run/response-schema.json", content: '{"type":"object"}\n' }],
    });
  });

  it("carries the normalization instruction only in stdin", () => {
    expect(
      strategy.documentNormalizationRun({
        workingDirectory: "/private/run",
        responseSchema: schema,
        instruction: "Normalize.",
      }).arguments,
    ).toEqual([...BASE, "--output-schema", "/private/run/response-schema.json", ...DISABLE, "-"]);
  });

  it("reads the last turn usage, counting cached input inside input", () => {
    expect(strategy.parseRun(completed({ ok: true })).usage).toEqual({
      inputTokens: 15,
      cachedInputTokens: 3,
      outputTokens: 4,
      reasoningOutputTokens: 1,
      totalTokens: 19,
      contextWindow: null,
    });
    expect(
      strategy.parseRun(
        events(
          { type: "item.completed", item: { type: "agent_message", text: "{}" } },
          { type: "turn.completed", usage: null },
        ),
      ).usage,
    ).toBeNull();
  });

  it("keeps the last agent message and tolerates the disabled code-mode notice", () => {
    const notice = {
      type: "item.completed",
      item: {
        type: "error",
        message:
          "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.",
      },
    };
    expect(
      strategy.parseRun(
        completed({ ok: true }, notice, {
          type: "item.completed",
          item: { type: "agent_message", text: "Preparing." },
        }),
      ).result,
    ).toEqual({ ok: true });
  });

  it("reports provider failure events as run failures without their message", () => {
    expect(() =>
      strategy.parseRun(events({ type: "turn.failed", error: { message: "PRIVATE" } })),
    ).toThrow(
      expect.objectContaining({
        kind: "run_failed",
        message: "The Codex run reported a provider failure.",
        details: { providerReportedFailure: true },
      }),
    );
  });

  it("probes the model input with every feature disabled and names only closed tools", async () => {
    const admission = strategy.admission;
    if (admission.kind !== "model_input") throw new Error("Codex admits by its model input.");
    const run = vi.fn(async () => ({
      status: "completed",
      stdout: JSON.stringify([
        { type: "additional_tools", tools: [{ name: "exec" }, { name: "private/path-token" }] },
      ]),
    }));
    await expect(admission.assertNoModelTools(run, 180_000)).rejects.toMatchObject({
      kind: "policy_violation",
      details: { exposedTools: ["exec", "other"] },
    });
    expect(run).toHaveBeenCalledWith({
      arguments: [
        "debug",
        "prompt-input",
        "-c",
        "mcp_servers={}",
        ...DISABLE,
        "Lervo no-tool capability probe.",
      ],
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
    });
    await expect(
      admission.assertNoModelTools(async () => ({ status: "timed_out", stdout: "" }), 10_000),
    ).rejects.toMatchObject({ details: { probeFailureReason: "probe_timed_out" } });
    await expect(
      admission.assertNoModelTools(
        async () => ({ status: "completed", stdout: '[{"type":"message"}]' }),
        10_000,
      ),
    ).resolves.toBeUndefined();
  });

  it("declares exactly the disabled features as its invocation identity", () => {
    expect(strategy.disabledCapabilities).toEqual(FEATURES);
  });
});
