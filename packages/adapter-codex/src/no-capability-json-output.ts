import {
  NO_CAPABILITY_PROBE_TOOL_NAMES,
  NoCapabilityInvocationFailure,
  nonNegativeUsageInteger,
  parseNoCapabilityResultText,
  parsedNoCapabilityJson,
  parsedNoCapabilityJsonObject,
  type NoCapabilityJsonUsage,
} from "@lervo/adapter-contract";

const INVALID_EVENT_STREAM = "Codex did not return a valid JSONL event stream.";

// Emitted even with every tool disabled; it reports the disabled host, not a capability.
const DISABLED_CODE_MODE_HOST_NOTICE =
  "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.";

function policyViolation(message: string): NoCapabilityInvocationFailure {
  return new NoCapabilityInvocationFailure("policy_violation", message);
}

function eventLines(stdout: string): string[] {
  return stdout.split(/\r?\n/u).filter((item) => item.trim() !== "");
}

/** The final agent message of an `exec --json` event stream that shows no tool or other item. */
export function parseCodexNoCapabilityOutput(stdout: string): Record<string, unknown> {
  let finalText: string | null = null;
  for (const line of eventLines(stdout)) {
    const event = parsedNoCapabilityJsonObject(line, INVALID_EVENT_STREAM) as {
      type?: unknown;
      item?: { type?: unknown; text?: unknown };
    };
    if (event.type === "item.started" || event.type === "item.completed") {
      const itemType = event.item?.type;
      if (
        event.type === "item.completed" &&
        itemType === "error" &&
        (event.item as { message?: unknown } | undefined)?.message ===
          DISABLED_CODE_MODE_HOST_NOTICE
      )
        continue;
      if (itemType !== "reasoning" && itemType !== "agent_message") {
        throw policyViolation(
          "A disallowed tool or capability event was observed during the Codex run.",
        );
      }
      if (event.type === "item.completed" && itemType === "agent_message") {
        if (typeof event.item?.text !== "string")
          throw new NoCapabilityInvocationFailure(
            "run_failed",
            "The Codex final response event is not a JSON message.",
          );
        finalText = event.item.text;
      }
      continue;
    }
    // Codex reports capacity, quota, and model failures as `error` and `turn.failed` events. They
    // are provider failures, not capability violations; the provider's message is not retained.
    if (event.type === "error" || event.type === "turn.failed") {
      throw new NoCapabilityInvocationFailure(
        "run_failed",
        "The Codex run reported a provider failure.",
        { providerReportedFailure: true },
      );
    }
    if (!["thread.started", "turn.started", "turn.completed"].includes(String(event.type))) {
      throw policyViolation("An event outside the contract was observed during the Codex run.");
    }
  }
  if (finalText === null)
    throw new NoCapabilityInvocationFailure("run_failed", "The Codex final response is missing.");
  return parseNoCapabilityResultText(finalText, "Codex") as Record<string, unknown>;
}

/** The last `turn.completed` usage; Codex counts cached input inside input tokens. */
export function codexNoCapabilityUsage(stdout: string): NoCapabilityJsonUsage | null {
  let result: NoCapabilityJsonUsage | null = null;
  for (const line of eventLines(stdout)) {
    const event = parsedNoCapabilityJsonObject(line, INVALID_EVENT_STREAM) as {
      type?: unknown;
      usage?: Record<string, unknown>;
    };
    if (event.type !== "turn.completed" || event.usage === undefined) continue;
    if (event.usage === null || typeof event.usage !== "object" || Array.isArray(event.usage))
      return null;
    const inputTokens = nonNegativeUsageInteger(event.usage.input_tokens);
    const cachedInputTokens = nonNegativeUsageInteger(event.usage.cached_input_tokens);
    const outputTokens = nonNegativeUsageInteger(event.usage.output_tokens);
    const reasoningOutputTokens = nonNegativeUsageInteger(event.usage.reasoning_output_tokens);
    if (
      inputTokens === null ||
      cachedInputTokens === null ||
      outputTokens === null ||
      reasoningOutputTokens === null
    ) {
      return null;
    }
    result = {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens: inputTokens + outputTokens,
      contextWindow: null,
    };
  }
  return result;
}

/** Closed tool names found in a model input; any other name is reported only as `other`. */
export function codexModelInputToolNames(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown, depth: number): void => {
    if (depth > 12 || item === null || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 128)) visit(child, depth + 1);
      return;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name === "string")
      found.add(
        NO_CAPABILITY_PROBE_TOOL_NAMES.includes(
          record.name as (typeof NO_CAPABILITY_PROBE_TOOL_NAMES)[number],
        )
          ? record.name
          : "other",
      );
    for (const child of Object.values(record).slice(0, 128)) visit(child, depth + 1);
  };
  visit(value, 0);
  return [...found].sort().slice(0, 16);
}

/** `debug prompt-input` output qualifies only when every item is a plain message. */
export function assertCodexModelInputHasNoTools(stdout: string): void {
  const items = parsedNoCapabilityJson(
    stdout,
    "The Codex model-input capability probe did not return JSON.",
  );
  if (
    !Array.isArray(items) ||
    items.some((item) => {
      const value = item as { type?: unknown } | null;
      return value === null || typeof value !== "object" || value.type !== "message";
    })
  ) {
    throw new NoCapabilityInvocationFailure(
      "policy_violation",
      "The Codex model input contains a disallowed tool or capability definition.",
      { exposedTools: codexModelInputToolNames(items) },
    );
  }
}
