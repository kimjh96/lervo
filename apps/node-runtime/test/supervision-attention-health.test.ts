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
