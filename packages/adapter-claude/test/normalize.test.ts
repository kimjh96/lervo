import type { AdapterSession } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { ClaudeEventNormalizer } from "../src/normalize.js";

const session: AdapterSession = {
  kind: "session",
  schemaVersion: 1,
  adapterId: "lervo/claude",
  projectId: "prj_01234567",
  runId: "run_01234567",
  sessionId: "ses_01234567",
  roleId: "developer",
  writingPolicyId: "writing_en-human",
  provider: "claude",
  providerSessionId: "11111111-1111-4111-8111-111111111111",
  executionMode: "read_only",
  effectiveCapabilities: {
    controlledContextInjection: "supported",
    toolCalls: "supported",
    commandExecution: "supported",
    fileChanges: "supported",
    contextCompaction: "supported",
    sessionResume: "unsupported",
    usage: "supported",
  },
  startedAt: "2026-08-31T00:00:00.000Z",
};

function normalizer(structuredOutputCarrierEnabled: boolean) {
  let event = 0;
  return new ClaudeEventNormalizer({
    session,
    repositoryRoot: "/repo",
    adapterVersion: "test",
    now: () => new Date("2026-08-31T00:00:00.000Z"),
    createEventId: () => `evt_test${String(++event).padStart(4, "0")}`,
    activeProviderTurnId: () => "22222222-2222-4222-8222-222222222222",
    structuredOutputCarrierEnabled,
  });
}

function toolUse(name: string, id = "tool-1") {
  return {
    type: "assistant",
    session_id: session.providerSessionId,
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", id, name, input: { private: "value" } }] },
  };
}

function toolResult(isError = false, id = "tool-1") {
  return {
    type: "user",
    session_id: session.providerSessionId,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: "private", is_error: isError }],
    },
  };
}

function successfulResult(structuredOutput: unknown = { answer: "ok" }, include = true) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: session.providerSessionId,
    user_message_uuid: "22222222-2222-4222-8222-222222222222",
    ...(include ? { structured_output: structuredOutput } : {}),
    duration_ms: 1,
    modelUsage: {
      test: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        contextWindow: 1_000,
      },
    },
  };
}

describe("Claude structured-output carrier normalization", () => {
  it("consumes the exact successful native carrier only when JSON Schema output is configured", () => {
    const enabled = normalizer(true);
    expect(enabled.normalize(toolUse("StructuredOutput"))).toEqual([]);
    expect(enabled.normalize(toolResult())).toEqual([]);

    const disabled = normalizer(false);
    disabled.normalize(toolUse("StructuredOutput"));
    expect(disabled.normalize(toolResult())).toHaveLength(1);
    expect(disabled.normalize(toolResult(false, "missing"))[0]?.type).toBe("provider.error");
  });

  it("keeps arbitrary tools observable and consumes a recovered carrier retry", () => {
    const instance = normalizer(true);
    instance.normalize(toolUse("Read"));
    const ordinary = instance.normalize(toolResult());
    expect(ordinary[0]?.type).toBe("provider.tool.called");

    instance.normalize(toolUse("StructuredOutput", "carrier"));
    const failed = instance.normalize(toolResult(true, "carrier"));
    expect(failed).toEqual([]);
    expect(
      instance.normalize(successfulResult()).some((event) => event.type === "provider.error"),
    ).toBe(false);
  });

  it("rejects terminal success without the configured structured output", () => {
    const instance = normalizer(true);
    const events = instance.normalize(successfulResult(undefined, false));
    expect(events.find((event) => event.type === "provider.error")?.payload).toMatchObject({
      failureCode: "structured_output_missing",
    });
  });

  it("does not classify a similar carrier name", () => {
    const instance = normalizer(true);
    instance.normalize(toolUse("structured_output"));
    expect(instance.normalize(toolResult())[0]?.type).toBe("provider.tool.called");
  });
});
