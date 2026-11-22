import { describe, expect, it } from "vitest";

import {
  foldPlanLedger,
  planItemId,
  planLedgerLines,
  type PlanLedgerEvent,
} from "../src/plan-ledger.js";

const source = {
  origin: "agent_command" as const,
  provider: null,
  sessionDigest: null,
  transcriptOffset: null,
};
const capture = (itemId: string, parentId: string | null, at: string): PlanLedgerEvent => ({
  type: "plan.item.captured",
  payload: { itemId, parentId, kind: "plan", title: itemId, state: "open", source, occurredAt: at },
});

describe("plan ledger fold (ADR-0563)", () => {
  const a = planItemId("a");
  const b = planItemId("b");
  const c = planItemId("c");

  it("never reopens or changes a closed item, whatever arrives later", () => {
    const ledger = foldPlanLedger([
      capture(a, null, "2026-11-22T00:00:00Z"),
      {
        type: "plan.item.closed",
        payload: {
          itemId: a,
          state: "cancelled",
          reason: "Withdrawn",
          evidence: [],
          supersededBy: null,
          occurredAt: "2026-11-22T00:01:00Z",
        },
      },
      {
        type: "plan.item.updated",
        payload: {
          itemId: a,
          parentId: null,
          title: "Reopened",
          state: "open",
          occurredAt: "2026-11-22T00:02:00Z",
        },
      },
      capture(a, null, "2026-11-22T00:03:00Z"),
    ]);
    expect(ledger.items.get(a)).toMatchObject({
      state: "cancelled",
      title: a,
      closed: { reason: "Withdrawn" },
    });
  });

  it("breaks a parent cycle at the earlier item and clears a missing parent", () => {
    const ledger = foldPlanLedger([
      capture(a, b, "2026-11-22T00:00:00Z"),
      capture(b, a, "2026-11-22T00:00:01Z"),
      capture(c, planItemId("missing"), "2026-11-22T00:00:02Z"),
    ]);
    expect([...ledger.items.values()].map((item) => item.parentId)).toEqual([null, a, null]);
  });

  it("lists open items with the closed ancestors that hold them", () => {
    const ledger = foldPlanLedger([
      capture(a, null, "2026-11-22T00:00:00Z"),
      capture(b, a, "2026-11-22T00:00:01Z"),
      capture(c, null, "2026-11-22T00:00:02Z"),
      {
        type: "plan.item.closed",
        payload: {
          itemId: a,
          state: "cancelled",
          reason: "Split",
          evidence: [],
          supersededBy: null,
          occurredAt: "2026-11-22T00:00:03Z",
        },
      },
      {
        type: "plan.item.closed",
        payload: {
          itemId: c,
          state: "cancelled",
          reason: "Dropped",
          evidence: [],
          supersededBy: null,
          occurredAt: "2026-11-22T00:00:04Z",
        },
      },
    ]);
    expect(
      planLedgerLines(ledger, { open: true }).map(({ item, depth }) => [item.itemId, depth]),
    ).toEqual([
      [a, 0],
      [b, 1],
    ]);
    expect(planLedgerLines(ledger)).toHaveLength(3);
  });
});
