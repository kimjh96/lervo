import type {
  RepositoryWorkTurnTokenUsage,
  RepositoryWorkTurnUsage,
} from "@lervo/adapter-contract";

const ADAPTER_ID = "claude/repository-work";

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

/** Sums every model row, including helper models, so the turn total matches provider billing. */
function modelUsageTotals(modelUsage: unknown): RepositoryWorkTurnTokenUsage | null {
  if (typeof modelUsage !== "object" || modelUsage === null || Array.isArray(modelUsage))
    return null;
  const rows = Object.values(modelUsage as Record<string, unknown>);
  if (rows.length === 0) return null;
  const totals: RepositoryWorkTurnTokenUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    contextWindow: null,
  };
  for (const value of rows) {
    if (typeof value !== "object" || value === null) return null;
    const row = value as Record<string, unknown>;
    const input = count(row.inputTokens);
    const output = count(row.outputTokens);
    const cacheRead = count(row.cacheReadInputTokens);
    const cacheCreation = count(row.cacheCreationInputTokens);
    if (input === null || output === null || cacheRead === null || cacheCreation === null)
      return null;
    const completeInput = input + cacheRead + cacheCreation;
    totals.inputTokens += completeInput;
    totals.cachedInputTokens += cacheRead;
    totals.outputTokens += output;
    totals.totalTokens += completeInput + output;
    const contextWindow = count(row.contextWindow);
    if (contextWindow !== null && contextWindow > 0)
      totals.contextWindow = Math.max(totals.contextWindow ?? 0, contextWindow);
  }
  return totals;
}

function primaryUsageTotals(usage: unknown): RepositoryWorkTurnTokenUsage | null {
  if (typeof usage !== "object" || usage === null) return null;
  const row = usage as Record<string, unknown>;
  const input = count(row.input_tokens);
  const output = count(row.output_tokens);
  const cacheRead = count(row.cache_read_input_tokens) ?? 0;
  const cacheCreation = count(row.cache_creation_input_tokens) ?? 0;
  if (input === null || output === null) return null;
  const completeInput = input + cacheRead + cacheCreation;
  return {
    inputTokens: completeInput,
    cachedInputTokens: cacheRead,
    outputTokens: output,
    reasoningOutputTokens: 0,
    totalTokens: completeInput + output,
    contextWindow: null,
  };
}

/** Normalizes the stream-json result counters; an absent or malformed counter is a reported gap. */
export function claudeRepositoryWorkUsage(result: {
  modelUsage?: unknown;
  usage?: unknown;
}): RepositoryWorkTurnUsage {
  const modelTotals = modelUsageTotals(result.modelUsage);
  if (modelTotals !== null) {
    return {
      adapterId: ADAPTER_ID,
      nativeCounterSemanticsId: "claude.stream-json.result.model-usage",
      status: "observed",
      usage: modelTotals,
    };
  }
  const primaryTotals = primaryUsageTotals(result.usage);
  return primaryTotals === null
    ? {
        adapterId: ADAPTER_ID,
        nativeCounterSemanticsId: "claude.stream-json.result.usage",
        status: "unavailable",
        reasonCode: "provider_usage_unreported",
      }
    : {
        adapterId: ADAPTER_ID,
        nativeCounterSemanticsId: "claude.stream-json.result.usage",
        status: "observed",
        usage: primaryTotals,
      };
}
