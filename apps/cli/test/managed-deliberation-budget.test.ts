import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  ManagedDeliberationBudgetController,
  observedRunTokens,
} from "../src/managed-deliberation-budget.js";

const budget = {
  maximumProviderCalls: 2,
  maximumObservedTokens: 100,
  maximumElapsedMs: 10_000,
  unobservedTokenDisposition: "block" as const,
};

function usageEvent(input: {
  totalTokens: number;
  scope?: string;
  status?: "observed" | "partial" | "unavailable";
  observation?: string;
}): EventEnvelope {
  const status = input.status ?? "observed";
  const usage = {
    inputTokens: input.totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: input.totalTokens,
    contextWindow: null,
  };
  return {
    type: "resource.usage.recorded",
    schemaVersion: 2,
    runId: "run_budget01",
    actor: { kind: "provider", provider: "codex" },
    payload: {
      workId: "wrk_000000000000000000000001",
      resourceObservationId: `ruo_${(input.observation ?? "1").padStart(24, "0")}`,
      sourceCoordinateDigest: `sha256:${"1".repeat(64)}`,
      scope: input.scope ?? "deliberation",
      source: "provider_reported",
      accountingMode: "turn_cumulative",
      accountingDescriptorHash: `sha256:${"2".repeat(64)}`,
      modelIdentity: {
        provider: "codex",
        requestedModel: null,
        answerModel: null,
        observedModelIds: [],
        answerModelEvidence: "unavailable",
        unavailableReason: "provider_model_unavailable",
      },
      status,
      usage: status === "unavailable" ? null : usage,
      reasonCode: status === "observed" ? null : "provider_usage_partial",
    },
  } as unknown as EventEnvelope;
}

function controller(events: EventEnvelope[] = []) {
  return new ManagedDeliberationBudgetController(
    { list: () => structuredClone(events) },
    budget,
    () => new Date("2026-09-17T00:00:00Z"),
  );
}

describe("managed deliberation execution budget", () => {
  it("fails closed when a completed provider run has no exact token observation", () => {
    const value = controller();
    value.admit();
    expect(() => value.observeCompletedRun("run_budget01")).toThrowError(
      expect.objectContaining({ code: "deliberation_budget_observation_unavailable" }),
    );
  });

  it("stops at the inclusive exact observed-token threshold", () => {
    const value = controller([usageEvent({ totalTokens: 100 })]);
    value.admit();
    expect(() => value.observeCompletedRun("run_budget01")).toThrowError(
      expect.objectContaining({ code: "deliberation_budget_exhausted" }),
    );
  });

  it("counts only complete usage of the expected scope", () => {
    expect(
      observedRunTokens(
        [
          usageEvent({ totalTokens: 900, scope: "publication_evaluation", observation: "2" }),
          usageEvent({ totalTokens: 700, status: "partial", observation: "3" }),
          usageEvent({ totalTokens: 0, status: "unavailable", observation: "4" }),
        ],
        "deliberation",
      ),
    ).toBeNull();
    expect(
      observedRunTokens(
        [
          usageEvent({ totalTokens: 40, observation: "5" }),
          usageEvent({ totalTokens: 40, observation: "5" }),
          usageEvent({ totalTokens: 25, observation: "6" }),
          usageEvent({ totalTokens: 900, scope: "primary_provider", observation: "7" }),
        ],
        "deliberation",
      ),
    ).toBe(65);
  });

  it("fails closed when only another scope or a partial record was observed", () => {
    const value = controller([
      usageEvent({ totalTokens: 10, scope: "primary_provider" }),
      usageEvent({ totalTokens: 10, status: "partial", observation: "2" }),
    ]);
    value.admit();
    expect(() => value.observeCompletedRun("run_budget01")).toThrowError(
      expect.objectContaining({ code: "deliberation_budget_observation_unavailable" }),
    );
  });

  it("carries consumed calls and tokens through a resume snapshot", () => {
    const value = new ManagedDeliberationBudgetController(
      { list: () => [] },
      budget,
      () => new Date("2026-09-17T00:00:01Z"),
      {
        providerCalls: 2,
        observedTokens: 90,
        startedAt: "2026-09-17T00:00:00Z",
      },
    );
    expect(() => value.admit()).toThrowError(
      expect.objectContaining({ code: "deliberation_budget_exhausted" }),
    );
  });

  it("reserves deterministic cleanup time before admitting a provider call", () => {
    const value = controller();
    expect(value.admit(3_000)).toBe(7_000);
  });

  it("does not start a provider call when only cleanup time remains", () => {
    const value = controller();
    expect(() => value.admit(10_000)).toThrowError(
      expect.objectContaining({ code: "deliberation_budget_exhausted" }),
    );
    expect(value.usage().providerCalls).toBe(0);
  });
});
