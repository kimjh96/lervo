import { describe, expect, it } from "vitest";
import { projectOwnerSpendAllowance } from "../src/owner-spend-allowance.js";

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
  it("retains full reservations across model changes, unavailable receipts and successors", () => {
    const first = reservation("a", 100_000);
    const second = reservation("b", 100_000);
    expect(
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: second.decisionId,
        reservations: [first, second],
      }),
    ).toEqual({ disposition: "within", reservedTokens: 200_000, remainingTokens: 0 });
    expect(
      projectOwnerSpendAllowance({
        allowance,
        currentDecisionId: id("c"),
        reservations: [first, second, reservation("c", 1)],
      }),
    ).toEqual({ disposition: "exceeded", reservedTokens: 200_001, remainingTokens: 0 });
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
});
