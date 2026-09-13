import { describe, expect, it } from "vitest";
import {
  isWorkspacePreparationAbsence,
  operatingContractHash,
  operatingDecisionId,
} from "../src/index.js";
import { plan as actionPlan, hash } from "./operating-supervision.fixture.js";

function fixture() {
  const plan = { ...actionPlan(), effectContract: "work.workspace_preparation.v1" };
  const expected = { workspaceId: `wsp_${"1".repeat(24)}`, provisionPlanHash: hash("2") };
  const sourceRevisionDigest = hash("3");
  const inspection = {
    schemaVersion: 3,
    kind: "work.effect_absence",
    effectContract: plan.effectContract,
    decisionId: operatingDecisionId(plan),
    planHash: operatingContractHash(plan),
    effectHash: plan.effectHash,
    sourceRevisionDigest,
    ...expected,
    workspaceRecordAbsent: true,
    coordinationEventsAbsent: true,
    hostRegistrationAbsent: true,
    workspacePathAbsent: true,
    eventHeadHash: hash("4"),
    observedAt: plan.deadline,
    invalidatedBy: "deadline_expired",
  };
  return { plan, expected, sourceRevisionDigest, inspection };
}

describe("unstarted workspace absence", () => {
  it("binds an expired decision to the exact host plan and the recovery source", () => {
    const f = fixture();
    expect(
      isWorkspacePreparationAbsence(f.inspection, f.plan, f.sourceRevisionDigest, f.expected),
    ).toBe(true);
    expect(
      isWorkspacePreparationAbsence(f.inspection, f.plan, f.sourceRevisionDigest, {
        ...f.expected,
        workspaceId: `wsp_${"2".repeat(24)}`,
      }),
    ).toBe(false);
  });
  it.each([
    { workspaceRecordAbsent: false },
    { coordinationEventsAbsent: false },
    { hostRegistrationAbsent: false },
    { workspacePathAbsent: false },
    { invalidatedBy: "operator_requested" },
    { observedAt: "2026-09-11T03:00:00.000Z" },
    { observedAt: "unknown" },
    { provisionPlanHash: hash("5") },
    { effectHash: hash("6") },
    { eventHeadHash: null },
    { schemaVersion: 2 },
    { uncheckedOverride: true },
  ])("rejects incomplete, stale or differently bound evidence %j", (change) => {
    const f = fixture();
    expect(
      isWorkspacePreparationAbsence(
        { ...f.inspection, ...change },
        f.plan,
        f.sourceRevisionDigest,
        f.expected,
      ),
    ).toBe(false);
  });
});
