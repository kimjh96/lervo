import { describe, expect, it } from "vitest";

import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
  OperatingMandate,
} from "@lervo/application-contract";
import { observeSupervisionResourceBudget } from "../src/supervision-resource-budget.js";

const plan = { reservedTokens: 200 } as OperatingActionPlanV1;
const mandate = { schemaVersion: 3, maximumAggregateTokens: 1_000 } as OperatingMandate;

describe("supervision resource budget projection", () => {
  it("reports a V3 mandate as one goal-scoped safety envelope", () => {
    expect(
      observeSupervisionResourceBudget({
        mandate,
        plan,
        admission: { observedAggregateTokens: 850, reservedAggregateTokens: 50 },
      }),
    ).toEqual({
      schemaVersion: 1,
      scope: "goal",
      limitTokens: 1_000,
      observedTokens: 850,
      reservedTokens: 50,
      requestedTokens: 200,
      remainingTokens: 100,
    });
  });

  it("labels predecessor mandates as workstream-wide and never invents unknown usage", () => {
    expect(
      observeSupervisionResourceBudget({
        mandate: { ...mandate, schemaVersion: 2 } as OperatingMandate,
        plan,
        admission: { observedAggregateTokens: 850, reservedAggregateTokens: 50 },
      }),
    ).toMatchObject({ scope: "workstream" });
    expect(
      observeSupervisionResourceBudget({
        mandate,
        plan,
        admission: {
          observedAggregateTokens: null,
          reservedAggregateTokens: 0,
        } as Pick<
          OperatingAdmissionSnapshotV1,
          "observedAggregateTokens" | "reservedAggregateTokens"
        >,
      }),
    ).toBeNull();
  });

  it("does not project a cumulative budget for per-attempt-only authority", () => {
    expect(
      observeSupervisionResourceBudget({
        mandate: {
          ...mandate,
          aggregateTokenPolicy: { schemaVersion: 1, mode: "per_attempt_only" },
        } as OperatingMandate,
        plan,
        admission: { observedAggregateTokens: 900, reservedAggregateTokens: 50 },
      }),
    ).toBeNull();
  });
});
