import { describe, expect, it } from "vitest";

import { normalizeGovernedLoopPolicy } from "@lervo/application-contract";

import { assessManagedExecutionBudgets, managedExecutionBudgetAction } from "../src/index.js";

const descriptor = `sha256:${"a".repeat(64)}`;

describe("managed execution budgets", () => {
  it("assesses exact token dimensions and per-run duration without summing profiles", () => {
    const policy = normalizeGovernedLoopPolicy({
      tokenMetricLimits: [
        {
          provider: "codex",
          scope: "primary_provider",
          accountingDescriptorHash: descriptor,
          metric: "cached_input_tokens",
          stopAfterObservedTokens: 30,
        },
      ],
      durationLimits: [
        {
          provider: "codex",
          scope: "primary_provider",
          stageId: "provider_turn",
          stopAfterObservedDurationMs: 100,
        },
      ],
    });
    const assessments = assessManagedExecutionBudgets({
      policy,
      resources: [
        {
          schemaVersion: 1,
          provider: "codex",
          scope: "primary_provider",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: descriptor,
          completeness: "complete",
          tokenUsage: {
            inputTokens: 80,
            cachedInputTokens: 30,
            outputTokens: 20,
            reasoningOutputTokens: 5,
            totalTokens: 100,
          },
          totalTokens: 100,
          runCount: 1,
          reasonCodes: [],
        },
      ],
      stages: [
        {
          schemaVersion: 1,
          provider: "codex",
          scope: "primary_provider",
          stageId: "provider_turn",
          completeness: "complete",
          observations: [
            {
              runId: "run_111111111111111111111111",
              environmentProfileDigest: `sha256:${"b".repeat(64)}`,
              durationMs: 60,
              outcome: "completed",
            },
            {
              runId: "run_222222222222222222222222",
              environmentProfileDigest: `sha256:${"c".repeat(64)}`,
              durationMs: 60,
              outcome: "completed",
            },
          ],
          runCount: 2,
          reasonCodes: [],
        },
      ],
    });

    expect(assessments).toEqual([
      expect.objectContaining({
        kind: "token",
        metric: "cached_input_tokens",
        observedTokens: 30,
        thresholdState: "reached",
      }),
      expect.objectContaining({
        kind: "duration",
        maximumObservedDurationMs: 60,
        observationCount: 2,
        thresholdState: "below",
      }),
    ]);
    expect(managedExecutionBudgetAction({ assessments, policy })).toMatchObject({
      kind: "block",
      reasonCode: "token_budget_exhausted",
    });
  });

  it("fails closed when an exact metric or stage population is incomplete", () => {
    const policy = normalizeGovernedLoopPolicy({
      durationLimits: [
        {
          provider: "claude",
          scope: "primary_provider",
          stageId: "total",
          stopAfterObservedDurationMs: 1000,
        },
      ],
    });
    const assessments = assessManagedExecutionBudgets({ resources: [], stages: [], policy });
    expect(assessments).toEqual([
      expect.objectContaining({
        kind: "duration",
        maximumObservedDurationMs: null,
        completeness: "unobserved",
        thresholdState: "unknown",
      }),
    ]);
    expect(managedExecutionBudgetAction({ assessments, policy })).toMatchObject({
      kind: "escalate",
      reasonCode: "budget_observation_unavailable",
    });
  });
});
