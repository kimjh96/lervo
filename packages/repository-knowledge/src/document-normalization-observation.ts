import { RepositoryKnowledgeError } from "./types.js";

import type { DocumentNormalizationResourceCeilings } from "./document-normalization-workset.js";

export interface ObservedDocumentNormalizationTokenUsage {
  status: "observed";
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UnavailableDocumentNormalizationTokenUsage {
  status: "unavailable";
  reason: "normalization_usage_unavailable";
}

export type DocumentNormalizationTokenUsage =
  ObservedDocumentNormalizationTokenUsage | UnavailableDocumentNormalizationTokenUsage;

export interface DocumentNormalizationCompilerObservation {
  response: unknown;
  tokenUsage: DocumentNormalizationTokenUsage;
}

export interface DocumentNormalizationResourceObservation {
  providerCalls: number;
  elapsedMilliseconds: number;
  tokenUsage:
    | ObservedDocumentNormalizationTokenUsage
    | (UnavailableDocumentNormalizationTokenUsage & {
        observedProviderCalls: number;
        unavailableProviderCalls: number;
      });
}

interface TokenTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function validTokenUsage(
  usage: DocumentNormalizationTokenUsage,
): usage is ObservedDocumentNormalizationTokenUsage {
  return (
    usage.status === "observed" &&
    [usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.totalTokens].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
    usage.cachedInputTokens <= usage.inputTokens &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
}

export function unavailableDocumentNormalizationTokenUsage(): UnavailableDocumentNormalizationTokenUsage {
  return { status: "unavailable", reason: "normalization_usage_unavailable" };
}

export function createDocumentNormalizationObservationTracker(
  ceilings: DocumentNormalizationResourceCeilings,
): {
  readonly requiresSerialExecution: boolean;
  startProviderCall(): void;
  finishProviderCall(input: {
    elapsedMilliseconds: number;
    tokenUsage: DocumentNormalizationTokenUsage;
  }): void;
  observation(): DocumentNormalizationResourceObservation;
} {
  let providerCalls = 0;
  let elapsedMilliseconds = 0;
  let observedProviderCalls = 0;
  let unavailableProviderCalls = 0;
  const totals: TokenTotals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  const assertNextCallWithinObservedBudget = (): void => {
    if (providerCalls >= ceilings.maximumProviderCalls)
      throw new RepositoryKnowledgeError(
        "normalization_budget_exceeded",
        "The document normalization provider-call ceiling was reached before the next call.",
      );
    if (
      ceilings.maximumElapsedMilliseconds !== null &&
      elapsedMilliseconds >= ceilings.maximumElapsedMilliseconds
    )
      throw new RepositoryKnowledgeError(
        "normalization_budget_exceeded",
        "The document normalization elapsed-time ceiling was reached before the next call.",
      );
    if (ceilings.maximumObservedTokens === null) return;
    if (unavailableProviderCalls > 0)
      throw new RepositoryKnowledgeError(
        "normalization_usage_unavailable",
        "Document normalization token usage was unavailable, so the observed-token ceiling cannot admit another provider call.",
      );
    if (totals.totalTokens >= ceilings.maximumObservedTokens)
      throw new RepositoryKnowledgeError(
        "normalization_budget_exceeded",
        "The document normalization observed-token ceiling was reached before the next call.",
      );
  };

  return {
    requiresSerialExecution:
      ceilings.maximumObservedTokens !== null || ceilings.maximumElapsedMilliseconds !== null,
    startProviderCall() {
      assertNextCallWithinObservedBudget();
      providerCalls += 1;
    },
    finishProviderCall(input) {
      if (!Number.isSafeInteger(input.elapsedMilliseconds) || input.elapsedMilliseconds < 0)
        throw new RepositoryKnowledgeError(
          "knowledge_compile_policy_violation",
          "The document normalization compiler elapsed-time observation is invalid.",
        );
      elapsedMilliseconds += input.elapsedMilliseconds;
      if (!Number.isSafeInteger(elapsedMilliseconds))
        throw new RepositoryKnowledgeError(
          "knowledge_compile_policy_violation",
          "The document normalization elapsed-time aggregate exceeds the safe integer range.",
        );
      if (!validTokenUsage(input.tokenUsage)) {
        unavailableProviderCalls += 1;
        return;
      }
      observedProviderCalls += 1;
      totals.inputTokens += input.tokenUsage.inputTokens;
      totals.cachedInputTokens += input.tokenUsage.cachedInputTokens;
      totals.outputTokens += input.tokenUsage.outputTokens;
      totals.totalTokens += input.tokenUsage.totalTokens;
      if (Object.values(totals).some((value) => !Number.isSafeInteger(value)))
        throw new RepositoryKnowledgeError(
          "knowledge_compile_policy_violation",
          "The document normalization token aggregate exceeds the safe integer range.",
        );
    },
    observation() {
      return {
        providerCalls,
        elapsedMilliseconds,
        tokenUsage:
          unavailableProviderCalls === 0
            ? { status: "observed", ...totals }
            : {
                status: "unavailable",
                reason: "normalization_usage_unavailable",
                observedProviderCalls,
                unavailableProviderCalls,
              },
      };
    },
  };
}
