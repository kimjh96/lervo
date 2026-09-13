import { describe, expect, it } from "vitest";
import {
  isManagedExecutionAbsence,
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
} from "../src/index.js";
import { plan as actionPlan, hash } from "./operating-supervision.fixture.js";

function fixture() {
  const plan = { ...actionPlan(), effectContract: "work.managed_execution.v1" };
  const expected = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  const sourceRevisionDigest = hash("3");
  const inspection = {
    schemaVersion: 4,
    kind: "work.effect_absence",
    effectContract: plan.effectContract,
    decisionId: operatingDecisionId(plan),
    planHash: operatingContractHash(plan),
    effectHash: plan.effectHash,
    sourceRevisionDigest,
    ...expected,
    runEventsAbsent: true,
    eventHeadHash: hash("4"),
    observedAt: plan.deadline,
    invalidatedBy: "deadline_expired",
  };
  return { plan, expected, sourceRevisionDigest, inspection };
}

describe("unstarted managed execution absence", () => {
  it("binds an expired decision to the exact host plan and the recovery source", () => {
    const f = fixture();
    expect(isManagedExecutionAbsence(f.inspection, f.plan, f.sourceRevisionDigest)).toBe(true);
  });
  it.each([
    { runEventsAbsent: false },
    { runId: "run_foreign" },
    { sessionId: "ses_foreign" },
    { invalidatedBy: "operator_requested" },
    { observedAt: "2026-09-11T03:00:00.000Z" },
    { observedAt: "unknown" },
    { planHash: hash("5") },
    { effectHash: hash("6") },
    { eventHeadHash: null },
    { schemaVersion: 2 },
    { uncheckedOverride: true },
  ])("rejects incomplete, stale or differently bound evidence %j", (change) => {
    const f = fixture();
    expect(
      isManagedExecutionAbsence({ ...f.inspection, ...change }, f.plan, f.sourceRevisionDigest),
    ).toBe(false);
  });
});
