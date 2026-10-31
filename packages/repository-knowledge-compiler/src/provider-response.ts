import { canonicalJson } from "@lervo/repository-knowledge";
import type { NoCapabilityTelemetry } from "./process-provider-contract.js";
import { compileFailure, policyFailure, parsedJson, parsedJsonObject } from "./compiler-failure.js";
function observedResponse<T extends { telemetry: NoCapabilityTelemetry }>(value: unknown): T {
  const raw = value as Omit<T, "telemetry">;
  return {
    ...raw,
    telemetry: {
      filesystemReads: 0,
      filesystemWrites: 0,
      shellProcesses: 0,
      networkRequests: 0,
      externalActions: 0,
      toolCalls: 0,
      complete: true,
    },
  } as T;
}

export function parseProviderResultText(value: string, provider: "Codex" | "Claude"): unknown {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw compileFailure(`${provider} final response is not JSON.`);
    return parsedJson(
      candidate.slice(start, end + 1),
      `${provider} final response is not a single JSON object.`,
    );
  }
}

export function parseCodexOutput<
  T extends { telemetry: NoCapabilityTelemetry } = { telemetry: NoCapabilityTelemetry },
>(stdout: string): T {
  let finalText: string | null = null;
  for (const line of stdout.split(/\r?\n/u).filter((item) => item.trim() !== "")) {
    const event = parsedJsonObject(line, "Codex did not return a valid JSONL event stream.") as {
      type?: unknown;
      item?: { type?: unknown; text?: unknown };
    };
    if (event.type === "item.started" || event.type === "item.completed") {
      const itemType = event.item?.type;
      if (
        event.type === "item.completed" &&
        itemType === "error" &&
        (event.item as { message?: unknown } | undefined)?.message ===
          "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`."
      )
        continue;
      if (itemType !== "reasoning" && itemType !== "agent_message") {
        throw policyFailure(
          "A disallowed tool or capability event was observed during the Codex run.",
        );
      }
      if (event.type === "item.completed" && itemType === "agent_message") {
        if (typeof event.item?.text !== "string")
          throw compileFailure("The Codex final response event is not a JSON message.");
        finalText = event.item.text;
      }
      continue;
    }
    // Codex reports capacity, quota, and model failures as `error` and `turn.failed` events. They
    // are provider failures, not capability violations; the provider's message is not retained.
    if (event.type === "error" || event.type === "turn.failed") {
      throw Object.assign(compileFailure("The Codex run reported a provider failure."), {
        providerReportedFailure: true,
      });
    }
    if (!["thread.started", "turn.started", "turn.completed"].includes(String(event.type))) {
      throw policyFailure("An event outside the contract was observed during the Codex run.");
    }
  }
  if (finalText === null) throw compileFailure("The Codex final response is missing.");
  return observedResponse<T>(parseProviderResultText(finalText, "Codex"));
}

export function parseClaudeOutput<
  T extends { telemetry: NoCapabilityTelemetry } = { telemetry: NoCapabilityTelemetry },
>(stdout: string, options: { structuredOutputRequired?: boolean } = {}): T {
  const wrapper = parsedJsonObject(stdout, "Claude did not return a valid JSON result.") as {
    is_error?: unknown;
    result?: unknown;
    structured_output?: unknown;
    permission_denials?: unknown;
    stop_reason?: unknown;
    num_turns?: unknown;
    usage?: { server_tool_use?: { web_search_requests?: unknown; web_fetch_requests?: unknown } };
  };
  if (
    wrapper.permission_denials !== undefined &&
    (!Array.isArray(wrapper.permission_denials) || wrapper.permission_denials.length > 0)
  ) {
    throw policyFailure("A capability permission request was observed during the Claude run.");
  }
  const serverTools = wrapper.usage?.server_tool_use;
  const structuredOutput = wrapper.structured_output;
  if (options.structuredOutputRequired === true && structuredOutput === undefined) {
    throw policyFailure("The Claude run did not return native structured output.");
  }
  if (structuredOutput !== undefined) {
    if (
      wrapper.is_error !== false ||
      wrapper.stop_reason !== "tool_use" ||
      !Number.isSafeInteger(wrapper.num_turns) ||
      (wrapper.num_turns as number) < 2 ||
      (serverTools?.web_search_requests ?? 0) !== 0 ||
      (serverTools?.web_fetch_requests ?? 0) !== 0 ||
      typeof wrapper.result !== "string" ||
      typeof structuredOutput !== "object" ||
      structuredOutput === null ||
      Array.isArray(structuredOutput)
    ) {
      throw policyFailure("The Claude run did not prove the native structured-output contract.");
    }
    const resultObject = parseProviderResultText(wrapper.result, "Claude");
    if (canonicalJson(resultObject) !== canonicalJson(structuredOutput)) {
      throw policyFailure("The Claude native structured output does not match its final result.");
    }
    return observedResponse<T>(structuredOutput);
  }
  if (
    wrapper.is_error !== false ||
    wrapper.stop_reason !== "end_turn" ||
    wrapper.num_turns !== 1 ||
    (serverTools?.web_search_requests ?? 0) !== 0 ||
    (serverTools?.web_fetch_requests ?? 0) !== 0
  ) {
    throw policyFailure("The Claude run did not prove the single-turn no-tool contract.");
  }
  if (typeof wrapper.result !== "string")
    throw compileFailure("The Claude final response is missing.");
  return observedResponse<T>(parseProviderResultText(wrapper.result, "Claude"));
}
