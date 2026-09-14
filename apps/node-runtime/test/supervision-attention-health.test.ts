import { expect, it } from "vitest";

import { supervisionAttentionReasonCodes } from "../src/supervision-attention-health.js";

it("reports a completed goal with nothing to publish as a canonical local result", () => {
  expect(
    supervisionAttentionReasonCodes({ nextAction: "publish_result" }, ["owner_plan_unavailable"]),
  ).toEqual(["local_result_canonical"]);
  expect(
    supervisionAttentionReasonCodes({ nextAction: "dispatch" }, ["owner_plan_unavailable"]),
  ).toEqual(["owner_plan_unavailable"]);
  expect(
    supervisionAttentionReasonCodes({ nextAction: "publish_result" }, [
      "pending_decision_requires_reconciliation",
    ]),
  ).toEqual(["pending_decision_requires_reconciliation"]);
});

it("keeps unbounded codes out of health", () => {
  expect(supervisionAttentionReasonCodes({ nextAction: null }, ["Not Bounded!"])).toEqual([
    "reason_codes_unbounded",
  ]);
});

it("names a failed cycle with one bounded code and a journal line without newlines", async () => {
  const { supervisionCycleFailureCode, supervisionCycleFailureLine } =
    await import("../src/supervision-attention-health.js");
  const coded = Object.assign(new Error("The workstream changed."), {
    code: "supervision_readiness_changed",
  });
  expect(supervisionCycleFailureCode(coded)).toBe("supervision_readiness_changed");
  expect(supervisionCycleFailureCode(new TypeError("bad\nvalue"))).toBe("type");
  expect(supervisionCycleFailureCode("plain")).toBe("cycle_error_unclassified");
  const line = supervisionCycleFailureLine(new TypeError("bad\nvalue"));
  expect(line).toBe("Lervo supervision cycle failed (type): TypeError: bad value");
  expect(supervisionCycleFailureLine(new Error("x".repeat(400))).length).toBeLessThan(280);
});
