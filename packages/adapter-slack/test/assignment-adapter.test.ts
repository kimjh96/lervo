import { rm } from "node:fs/promises";

import { evaluateAssignmentConnectorPortConformance } from "@lervo/assignment-connector-conformance";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteSlackAssignmentConnectorState } from "../src/index.js";
import {
  CONNECTOR_ID,
  DESTINATION_ID,
  createSlackAssignmentFixture,
  type SlackAssignmentFixture,
} from "./assignment-fixture.js";

const fixtures: SlackAssignmentFixture[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async (fixture) => {
      fixture.state.close();
      await rm(fixture.root, { recursive: true, force: true });
    }),
  );
});

async function fixture(scenario: Parameters<typeof createSlackAssignmentFixture>[0]) {
  const value = await createSlackAssignmentFixture(scenario);
  fixtures.push(value);
  return value;
}

describe("Slack assignment connector", () => {
  it("passes shared delivery, replay, authorization, and privacy conformance", async () => {
    const report = await evaluateAssignmentConnectorPortConformance({
      connectorId: CONNECTOR_ID,
      destinationId: DESTINATION_ID,
      createHarness: async (scenario) => (await fixture(scenario)).harness,
    });

    expect(report.status).toBe("passed");
    expect(report.checks).toHaveLength(17);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("turns a crash after the send boundary into durable unknown without replay", async () => {
    const first = await fixture("delivered");
    const reservation = await first.connector.reserve(first.harness.plan);
    expect(reservation.status).toBe("reserved");
    if (reservation.status !== "reserved") return;
    await first.state.beginDelivery({
      plan: first.harness.plan,
      reservationId: reservation.reservationId,
      attemptedAt: "2026-09-02T08:00:01.000Z",
    });
    first.state.close();
    fixtures.splice(fixtures.indexOf(first), 1);

    const reopened = SqliteSlackAssignmentConnectorState.open(`${first.root}/delivery.sqlite`);
    const current = await reopened.reserve({
      plan: first.harness.plan,
      reservationId: reservation.reservationId,
      authorizationReceiptHash: reservation.authorizationReceiptHash,
      reservedAt: reservation.reservedAt,
    });

    expect(current).toMatchObject({ status: "current", observation: { status: "unknown" } });
    expect(reopened.listEvidence()).toHaveLength(1);
    reopened.close();
    await rm(first.root, { recursive: true, force: true });
  });

  it("keeps rejected and unknown evidence free of receipt claims", async () => {
    for (const scenario of ["rejected", "unknown"] as const) {
      const current = await fixture(scenario);
      const reservation = await current.connector.reserve(current.harness.plan);
      expect(reservation.status).toBe("reserved");
      if (reservation.status !== "reserved") continue;
      const result = await current.connector.deliver({
        plan: current.harness.plan,
        reservationId: reservation.reservationId,
      });
      expect(result).toMatchObject({
        status: scenario,
        deliveryReceiptHash: null,
        deliveryKeyHash: null,
        deliveredAt: null,
      });
    }
  });

  it("purges only bounded terminal evidence selected by retention policy", async () => {
    const current = await fixture("delivered");
    const reservation = await current.connector.reserve(current.harness.plan);
    expect(reservation.status).toBe("reserved");
    if (reservation.status !== "reserved") return;
    await current.connector.deliver({
      plan: current.harness.plan,
      reservationId: reservation.reservationId,
    });

    expect(current.state.purgeTerminal({ before: "2026-09-02T08:00:01.000Z", limit: 1 })).toBe(0);
    expect(current.state.purgeTerminal({ before: "2026-09-02T08:00:03.000Z", limit: 1 })).toBe(1);
    expect(current.state.listEvidence()).toEqual([]);
  });

  it("fails closed when the configured durable reservation capacity is reached", async () => {
    const current = await fixture("delivered");
    const bounded = SqliteSlackAssignmentConnectorState.open(`${current.root}/bounded.sqlite`, {
      maximumRecords: 1,
    });
    try {
      await bounded.reserve({
        plan: current.harness.plan,
        reservationId: "acres_capacity_first",
        authorizationReceiptHash: `sha256:${"a".repeat(64)}`,
        reservedAt: "2026-09-02T08:00:00.000Z",
      });
      await expect(
        bounded.reserve({
          plan: {
            ...current.harness.plan,
            planId: "acplan_capacity_second",
            outboundId: "acout_capacity_second",
          },
          reservationId: "acres_capacity_second",
          authorizationReceiptHash: `sha256:${"b".repeat(64)}`,
          reservedAt: "2026-09-02T08:00:01.000Z",
        }),
      ).rejects.toMatchObject({ code: "capacity_exceeded" });
    } finally {
      bounded.close();
    }
  });
});
