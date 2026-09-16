import { describe, expect, it } from "vitest";
import {
  isResultDeliveryAbsence,
  operatingContractHash,
  operatingDecisionId,
} from "../src/index.js";
import { hash, plan as actionPlan } from "./operating-supervision.fixture.js";

function fixture() {
  const plan = {
    ...actionPlan(),
    actionKind: "publish_result" as const,
    effectContract: "work.result_delivery.v2",
  };
  const sourceRevisionDigest = hash("3");
  const inspection = {
    schemaVersion: 8,
    kind: "work.effect_absence",
    effectContract: plan.effectContract,
    decisionId: operatingDecisionId(plan),
    planHash: operatingContractHash(plan),
    effectHash: plan.effectHash,
    sourceRevisionDigest,
    queueEventId: `evt_${"4".repeat(32)}`,
    queueEventAbsent: true,
    eventHeadHash: hash("5"),
    observedAt: plan.deadline,
    invalidatedBy: "source_changed",
  };
  return { plan, sourceRevisionDigest, inspection };
}

describe("unstarted result delivery absence", () => {
  it("binds queue absence to the exact publication plan and replacement source", () => {
    const f = fixture();
    expect(isResultDeliveryAbsence(f.inspection, f.plan, f.sourceRevisionDigest)).toBe(true);
  });

  it.each([
    { queueEventAbsent: false },
    { queueEventId: "evt_foreign" },
    { invalidatedBy: "operator_requested" },
    { sourceRevisionDigest: hash() },
    { observedAt: "unknown" },
    { planHash: hash("6") },
    { effectHash: hash("7") },
    { eventHeadHash: null },
    { schemaVersion: 7 },
    { uncheckedOverride: true },
  ])("rejects incomplete, stale or differently bound evidence %j", (change) => {
    const f = fixture();
    expect(
      isResultDeliveryAbsence({ ...f.inspection, ...change }, f.plan, f.sourceRevisionDigest),
    ).toBe(false);
  });
});
