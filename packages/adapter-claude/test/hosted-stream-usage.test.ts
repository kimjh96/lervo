import { describe, expect, it } from "vitest";

import { ClaudeHostedStreamDecoder } from "../src/index.js";

const encode = (lines: object[]) =>
  new TextEncoder().encode(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));

/** Two results as Claude Code 2026-11 reported them in a two-turn stream-json session. */
const first = {
  type: "result",
  subtype: "success",
  uuid: "0a695bbb-0ada-4ba9-9faf-6253c67299a2",
  result_index: 0,
  total_cost_usd: 0.00245174,
  model_usage_since_last_result: {
    "claude-haiku-5-5": {
      inputTokens: 2,
      outputTokens: 5,
      cacheReadInputTokens: 11844,
      cacheCreationInputTokens: 11653,
      thinkingTokens: 0,
      costUSD: 0.00245174,
      canonicalModel: "claude-haiku-5-5",
      costBasis: "list",
    },
  },
};
const second = {
  ...first,
  uuid: "3bf0657b-1f24-4d41-99c3-9bfe229d0154",
  result_index: 1,
  total_cost_usd: 0.00474262,
  model_usage_since_last_result: {
    "claude-haiku-5-5": {
      ...first.model_usage_since_last_result["claude-haiku-5-5"],
      inputTokens: 2,
      outputTokens: 88,
      cacheReadInputTokens: 15028,
      cacheCreationInputTokens: 10482,
      thinkingTokens: 83,
      costUSD: 0.00229088,
    },
  },
};

describe("a hosted turn's usage", () => {
  it("is each result's per-model usage, which sums to the provider's cumulative cost", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 1);
    decoder.output(encode([first]));
    const once = decoder.takeUsage();
    expect(once).toEqual([
      {
        turnKey: first.uuid,
        resultIndex: 0,
        modelKey: "claude-haiku-5-5",
        model: "claude-haiku-5-5",
        uncachedInputTokens: 2,
        cacheReadInputTokens: 11844,
        cacheCreationInputTokens: 11653,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        contextWindow: null,
        costUsd: 0.00245174,
        costBasis: "list",
      },
    ]);
    expect(decoder.takeUsage()).toEqual([]);
    decoder.output(encode([second]));
    const twice = decoder.takeUsage();
    expect(twice[0]).toMatchObject({ outputTokens: 88, reasoningOutputTokens: 83, resultIndex: 1 });
    expect(decoder.usageAccounting()).toMatchObject({
      provider: "claude",
      accountingMode: "operation_delta",
      observationSupport: "supported",
    });
    const total = [...once, ...twice].reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0);
    expect(total).toBeCloseTo(second.total_cost_usd, 10);
  });

  it("falls back to the turn's usage without a cost, and reports nothing without usage or a UUID", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 1);
    decoder.output(
      encode([
        { type: "assistant", message: { model: "claude-sonnet-5-5", content: [] } },
        {
          type: "result",
          subtype: "success",
          uuid: "c5f1",
          result_index: 0,
          usage: {
            input_tokens: 3,
            output_tokens: 7,
            cache_read_input_tokens: 1,
            cache_creation_input_tokens: 2,
          },
        },
        { type: "result", subtype: "success", uuid: "c5f2", result_index: 1 },
        { ...first, uuid: undefined },
      ]),
    );
    expect(decoder.takeUsage()).toEqual([
      {
        turnKey: "c5f1",
        resultIndex: 0,
        modelKey: "claude-sonnet-5-5",
        model: "claude-sonnet-5-5",
        uncachedInputTokens: 3,
        cacheReadInputTokens: 1,
        cacheCreationInputTokens: 2,
        outputTokens: 7,
        reasoningOutputTokens: null,
        contextWindow: null,
        costUsd: null,
        costBasis: "unreported",
      },
    ]);
  });

  it("keeps the counts of a model that fits no safe name, which it leaves unnamed", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 1);
    decoder.output(
      encode([
        {
          ...first,
          model_usage_since_last_result: {
            "weird model": { inputTokens: 1, outputTokens: 1, costUSD: 0.1 },
          },
        },
      ]),
    );
    expect(decoder.takeUsage()[0]).toMatchObject({
      modelKey: "weird model",
      model: null,
      uncachedInputTokens: 1,
      costUsd: 0.1,
    });
  });
});
