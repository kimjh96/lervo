import type {
  RepositoryWorkTurnTokenUsage,
  RepositoryWorkTurnUsage,
} from "@lervo/adapter-contract";

const ADAPTER_ID = "codex/repository-work";
const NATIVE_COUNTER_SEMANTICS_ID = "codex.exec-json.turn-completed.usage";

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

/** Normalizes one `turn.completed` usage object; returns null when a required counter is absent. */
export function codexTurnCompletedUsage(usage: unknown): RepositoryWorkTurnTokenUsage | null {
  if (typeof usage !== "object" || usage === null) return null;
  const row = usage as Record<string, unknown>;
  const inputTokens = count(row.input_tokens);
  const outputTokens = count(row.output_tokens);
  const cachedInputTokens = count(row.cached_input_tokens) ?? 0;
  const reasoningOutputTokens = count(row.reasoning_output_tokens) ?? 0;
  if (inputTokens === null || outputTokens === null) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + outputTokens,
    contextWindow: null,
  };
}

export function codexRepositoryWorkUsage(
  usage: RepositoryWorkTurnTokenUsage | null,
): RepositoryWorkTurnUsage {
  return usage === null
    ? {
        adapterId: ADAPTER_ID,
        nativeCounterSemanticsId: NATIVE_COUNTER_SEMANTICS_ID,
        status: "unavailable",
        reasonCode: "provider_usage_unreported",
      }
    : {
        adapterId: ADAPTER_ID,
        nativeCounterSemanticsId: NATIVE_COUNTER_SEMANTICS_ID,
        status: "observed",
        usage,
      };
}
