import type { DocumentNormalizationCompilerObservation } from "@lervo/repository-knowledge";
import type { ProviderJsonUsage } from "./process-provider-contract.js";

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
