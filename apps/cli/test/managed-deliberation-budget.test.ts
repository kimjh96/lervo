import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { ManagedDeliberationBudgetController } from "../src/managed-deliberation-budget.js";

const budget = {
  maximumProviderCalls: 2,
  maximumObservedTokens: 100,
  maximumElapsedMs: 10_000,
  unobservedTokenDisposition: "block" as const,
};

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
    const event = {
      type: "resource.usage.recorded",
      runId: "run_budget01",
      payload: { usage: { totalTokens: 100 } },
    } as unknown as EventEnvelope;
    const value = controller([event]);
    value.admit();
    expect(() => value.observeCompletedRun("run_budget01")).toThrowError(
      expect.objectContaining({ code: "deliberation_budget_exhausted" }),
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
