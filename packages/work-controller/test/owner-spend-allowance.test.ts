import { describe, expect, it } from "vitest";
import {
  ownerSpendAdmitsReservation,
  projectOwnerSpendAllowance,
} from "../src/owner-spend-allowance.js";

const allowance = {
  schemaVersion: 1 as const,
  mode: "incremental_reservation" as const,
  projectId: `prj_${"a".repeat(16)}`,
  anchorEventId: `evt_${"b".repeat(32)}`,
  anchorEventHash: `sha256:${"c".repeat(64)}`,
  maximumReservedTokens: 200_000,
};
const id = (hex: string) => `osd_${hex.repeat(24)}`;
const reservation = (hex: string, reservedTokens: number) => ({
  decisionId: id(hex),
  reservedTokens,
  observedTokens: null,
  usageUnavailable: false,
});

describe("owner spend epoch", () => {
  it("charges a decision without a usage receipt at its full reservation", () => {
    const first = reservation("a", 100_000);
    const second = reservation("b", 100_000);
    expect(
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: second.decisionId,
        reservations: [first, second],
      }),
    ).toEqual({ disposition: "within", chargedTokens: 200_000, remainingTokens: 0 });
    expect(
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: id("c"),
        reservations: [first, second, reservation("c", 1)],
      }),
    ).toEqual({ disposition: "exceeded", chargedTokens: 200_001, remainingTokens: 0 });
  });

  it("charges a completed decision its provider-reported usage, not its reservation", () => {
    const completed = { ...reservation("a", 150_000), observedTokens: 40_000 };
    const current = reservation("b", 150_000);
    expect(
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: current.decisionId,
        reservations: [completed, current],
      }),
    ).toEqual({ disposition: "within", chargedTokens: 190_000, remainingTokens: 10_000 });
    expect(
      ownerSpendAdmitsReservation({
        allowance,
        reservations: [completed],
        nextReservedTokens: 150_000,
      }),
    ).toBe(true);
    expect(
      ownerSpendAdmitsReservation({
        allowance,
        reservations: [completed, current],
        nextReservedTokens: 10_001,
      }),
    ).toBe(false);
  });

  it("fails closed for missing, duplicated, malformed, or overflowing evidence", () => {
    const first = reservation("a", 100_000);
    expect(() =>
      projectOwnerSpendAllowance({ allowance, currentDecisionId: id("b"), reservations: [first] }),
    ).toThrow(/omits/u);
    expect(() =>
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: first.decisionId,
        reservations: [first, first],
      }),
    ).toThrow(/duplicate/u);
    expect(() =>
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: first.decisionId,
        reservations: [{ ...first, reservedTokens: 0 }],
      }),
    ).toThrow(/invalid/u);
    expect(() =>
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: id("b"),
        reservations: [reservation("a", Number.MAX_SAFE_INTEGER), reservation("b", 1)],
      }),
    ).toThrow(/safe integer/u);
  });

  it("halts later starts after unavailable usage or a provider-reported overrun", () => {
    for (const prior of [
      { ...reservation("a", 100_000), usageUnavailable: true },
      { ...reservation("a", 100_000), observedTokens: 100_001 },
    ])
      expect(
        projectOwnerSpendAllowance({
          allowance,
          currentDecisionId: id("b"),
          reservations: [prior, reservation("b", 100_000)],
        }).disposition,
      ).toBe("exceeded");
  });

  it("refuses a further reservation before recording once the epoch cannot admit it", () => {
    const first = reservation("a", 100_000);
    expect(
      ownerSpendAdmitsReservation({ allowance, reservations: [], nextReservedTokens: 100_000 }),
    ).toBe(true);
    expect(
      ownerSpendAdmitsReservation({
        allowance,
        reservations: [first],
        nextReservedTokens: 100_000,
      }),
    ).toBe(true);
    expect(
      ownerSpendAdmitsReservation({
        allowance,
        reservations: [first],
        nextReservedTokens: 100_001,
      }),
    ).toBe(false);
    // An unavailable receipt already makes every later reservation exceed the epoch.
    expect(
      ownerSpendAdmitsReservation({
        allowance,
        reservations: [{ ...first, usageUnavailable: true }],
        nextReservedTokens: 1,
      }),
    ).toBe(false);
    expect(() =>
      ownerSpendAdmitsReservation({ allowance, reservations: [first], nextReservedTokens: 0 }),
    ).toThrow(/invalid/u);
  });
});
