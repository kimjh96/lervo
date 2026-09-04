import { describe, expect, it } from "vitest";

import {
  createDocumentNormalizationObservationTracker,
  resolveDocumentNormalizationResourceCeilings,
  unavailableDocumentNormalizationTokenUsage,
} from "../src/index.js";

function tracker(
  overrides: Parameters<typeof resolveDocumentNormalizationResourceCeilings>[0] = {},
) {
  return createDocumentNormalizationObservationTracker(
    resolveDocumentNormalizationResourceCeilings(overrides),
  );
}

describe("document normalization resource observation", () => {
  it("aggregates complete provider-neutral usage and elapsed time", () => {
    const observation = tracker();
    observation.startProviderCall();
    observation.finishProviderCall({
      elapsedMilliseconds: 120,
      tokenUsage: {
        status: "observed",
        inputTokens: 40,
        cachedInputTokens: 10,
        outputTokens: 8,
        totalTokens: 48,
      },
    });
    observation.startProviderCall();
    observation.finishProviderCall({
      elapsedMilliseconds: 80,
      tokenUsage: {
        status: "observed",
        inputTokens: 20,
        cachedInputTokens: 0,
        outputTokens: 4,
        totalTokens: 24,
      },
    });

    expect(observation.observation()).toEqual({
      providerCalls: 2,
      elapsedMilliseconds: 200,
      tokenUsage: {
        status: "observed",
        inputTokens: 60,
        cachedInputTokens: 10,
        outputTokens: 12,
        totalTokens: 72,
      },
    });
  });

  it("keeps unavailable usage explicit instead of reporting a partial total", () => {
    const observation = tracker();
    observation.startProviderCall();
    observation.finishProviderCall({
      elapsedMilliseconds: 10,
      tokenUsage: {
        status: "observed",
        inputTokens: 12,
        cachedInputTokens: 2,
        outputTokens: 3,
        totalTokens: 15,
      },
    });
    observation.startProviderCall();
    observation.finishProviderCall({
      elapsedMilliseconds: 5,
      tokenUsage: unavailableDocumentNormalizationTokenUsage(),
    });

    expect(observation.observation()).toEqual({
      providerCalls: 2,
      elapsedMilliseconds: 15,
      tokenUsage: {
        status: "unavailable",
        reason: "normalization_usage_unavailable",
        observedProviderCalls: 1,
        unavailableProviderCalls: 1,
      },
    });
  });

  it("stops before the next call after observed-token or elapsed-time exhaustion", () => {
    const tokens = tracker({ maximumObservedTokens: 20 });
    expect(tokens.requiresSerialExecution).toBe(true);
    tokens.startProviderCall();
    tokens.finishProviderCall({
      elapsedMilliseconds: 1,
      tokenUsage: {
        status: "observed",
        inputTokens: 18,
        cachedInputTokens: 0,
        outputTokens: 2,
        totalTokens: 20,
      },
    });
    expect(() => tokens.startProviderCall()).toThrowError(
      expect.objectContaining({ code: "normalization_budget_exceeded" }),
    );

    const elapsed = tracker({ maximumElapsedMilliseconds: 50 });
    elapsed.startProviderCall();
    elapsed.finishProviderCall({
      elapsedMilliseconds: 50,
      tokenUsage: {
        status: "observed",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        totalTokens: 2,
      },
    });
    expect(() => elapsed.startProviderCall()).toThrowError(
      expect.objectContaining({ code: "normalization_budget_exceeded" }),
    );
  });

  it("fails closed before another call when a token ceiling cannot be observed", () => {
    const observation = tracker({ maximumObservedTokens: 100 });
    observation.startProviderCall();
    observation.finishProviderCall({
      elapsedMilliseconds: 1,
      tokenUsage: unavailableDocumentNormalizationTokenUsage(),
    });

    expect(() => observation.startProviderCall()).toThrowError(
      expect.objectContaining({ code: "normalization_usage_unavailable" }),
    );
  });
});
