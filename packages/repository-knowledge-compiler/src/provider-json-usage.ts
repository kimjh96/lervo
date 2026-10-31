import type { DocumentNormalizationCompilerObservation } from "@lervo/repository-knowledge";
import type { ProviderJsonUsage } from "./process-provider-contract.js";
import { parsedJsonObject } from "./compiler-failure.js";
function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function codexJsonUsage(stdout: string): ProviderJsonUsage | null {
  let result: ProviderJsonUsage | null = null;
  for (const line of stdout.split(/\r?\n/u).filter((item) => item.trim() !== "")) {
    const event = parsedJsonObject(line, "Codex did not return a valid JSONL event stream.") as {
      type?: unknown;
      usage?: Record<string, unknown>;
    };
    if (event.type !== "turn.completed" || event.usage === undefined) continue;
    if (event.usage === null || typeof event.usage !== "object" || Array.isArray(event.usage))
      return null;
    const inputTokens = nonNegativeInteger(event.usage.input_tokens);
    const cachedInputTokens = nonNegativeInteger(event.usage.cached_input_tokens);
    const outputTokens = nonNegativeInteger(event.usage.output_tokens);
    const reasoningOutputTokens = nonNegativeInteger(event.usage.reasoning_output_tokens);
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

export function claudeJsonUsage(stdout: string): ProviderJsonUsage | null {
  const wrapper = parsedJsonObject(stdout, "Claude did not return a valid JSON result.") as {
    modelUsage?: unknown;
  };
  if (
    typeof wrapper.modelUsage !== "object" ||
    wrapper.modelUsage === null ||
    Array.isArray(wrapper.modelUsage)
  ) {
    return null;
  }
  const totals: ProviderJsonUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    contextWindow: null,
  };
  const rows = Object.values(wrapper.modelUsage as Record<string, unknown>);
  if (rows.length === 0) return null;
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const inputTokens = nonNegativeInteger(row.inputTokens);
    const outputTokens = nonNegativeInteger(row.outputTokens);
    const cacheReadInputTokens = nonNegativeInteger(row.cacheReadInputTokens);
    const cacheCreationInputTokens = nonNegativeInteger(row.cacheCreationInputTokens);
    const contextWindow = nonNegativeInteger(row.contextWindow);
    if (
      inputTokens === null ||
      outputTokens === null ||
      cacheReadInputTokens === null ||
      cacheCreationInputTokens === null ||
      contextWindow === null
    ) {
      return null;
    }
    const completeInputTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
    totals.inputTokens += completeInputTokens;
    totals.cachedInputTokens += cacheReadInputTokens;
    totals.outputTokens += outputTokens;
    totals.totalTokens += completeInputTokens + outputTokens;
    totals.contextWindow = Math.max(totals.contextWindow ?? 0, contextWindow);
  }
  return totals;
}

export function documentNormalizationTokenUsage(
  usage: ProviderJsonUsage | null,
): DocumentNormalizationCompilerObservation["tokenUsage"] {
  return usage === null
    ? { status: "unavailable", reason: "normalization_usage_unavailable" }
    : {
        status: "observed",
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      };
}
