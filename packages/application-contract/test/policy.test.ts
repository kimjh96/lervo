import { describe, expect, it } from "vitest";

import { normalizeGovernedLoopPolicy } from "../src/index.js";

describe("governed loop policy", () => {
  it("creates bounded fail-closed defaults", () => {
    expect(normalizeGovernedLoopPolicy()).toEqual({
      schemaVersion: 1,
      maxAttemptsPerAssignment: 2,
      maxParallelAssignments: 2,
      tokenLimits: [],
      tokenMetricLimits: [],
      durationLimits: [],
      unobservedResourceAction: "escalate",
      exhaustedResourceAction: "block",
      terminalFailureAction: "escalate",
    });
  });

  it("rejects duplicate accounting coordinates", () => {
    const limit = {
      provider: "codex" as const,
      accountingDescriptorHash: `sha256:${"a".repeat(64)}`,
      stopAfterObservedTotalTokens: 100,
    };
    expect(() => normalizeGovernedLoopPolicy({ tokenLimits: [limit, limit] })).toThrow(
      "coordinates are invalid",
    );
  });

  it("keeps otherwise identical limits distinct by resource scope", () => {
    const accountingDescriptorHash = `sha256:${"a".repeat(64)}`;
    expect(
      normalizeGovernedLoopPolicy({
        tokenLimits: [
          {
            provider: "codex",
            scope: "primary_provider",
            accountingDescriptorHash,
            stopAfterObservedTotalTokens: 100,
          },
          {
            provider: "codex",
            scope: "subagent_provider",
            accountingDescriptorHash,
            stopAfterObservedTotalTokens: 50,
          },
        ],
      }).tokenLimits,
    ).toHaveLength(2);
  });

  it("keeps token dimensions independent and validates duration coordinates", () => {
    const accountingDescriptorHash = `sha256:${"a".repeat(64)}`;
    const policy = normalizeGovernedLoopPolicy({
      tokenMetricLimits: [
        {
          provider: "codex",
          scope: "primary_provider",
          accountingDescriptorHash,
          metric: "input_tokens",
          stopAfterObservedTokens: 100,
        },
        {
          provider: "codex",
          scope: "primary_provider",
          accountingDescriptorHash,
          metric: "cached_input_tokens",
          stopAfterObservedTokens: 40,
        },
      ],
      durationLimits: [
        {
          provider: "codex",
          scope: "primary_provider",
          stageId: "provider_turn",
          stopAfterObservedDurationMs: 30_000,
        },
      ],
    });
    expect(policy.tokenMetricLimits.map((limit) => limit.metric)).toEqual([
      "cached_input_tokens",
      "input_tokens",
    ]);
    expect(policy.durationLimits).toEqual([
      expect.objectContaining({ stageId: "provider_turn", stopAfterObservedDurationMs: 30_000 }),
    ]);
  });

  it("keeps total-token policy out of the dimension-limit boundary", () => {
    expect(() =>
      normalizeGovernedLoopPolicy({
        tokenMetricLimits: [
          {
            provider: "codex",
            accountingDescriptorHash: `sha256:${"a".repeat(64)}`,
            metric: "total_tokens",
            stopAfterObservedTokens: 100,
          },
        ],
      } as unknown as Parameters<typeof normalizeGovernedLoopPolicy>[0]),
    ).toThrow("coordinates are invalid");
  });
});
