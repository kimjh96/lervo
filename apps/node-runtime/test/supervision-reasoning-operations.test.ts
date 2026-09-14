import { expect, it } from "vitest";
import type { OwnerReasoningContext } from "../src/supervision-reasoning-context.js";
import { supervisionReasoningDecisionSchema } from "../src/supervision-reasoning-operations.js";

it("permits exact re-review or escalation after a blocked review without reopening work", () => {
  const context = {
    trigger: { reasonCode: "acceptance_blocked", nextAction: "escalate", assignmentIds: [] },
  } as unknown as OwnerReasoningContext;
  expect(supervisionReasoningDecisionSchema(context).properties.operation.enum).toEqual([
    "review_artifacts",
    "escalate",
  ]);
});
