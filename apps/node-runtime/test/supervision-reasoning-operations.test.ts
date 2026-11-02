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

it("lets the owner allocate remaining goal scope once every current assignment is accepted", () => {
  const context = {
    trigger: {
      reasonCode: "canonical_completion_required",
      nextAction: "complete_workstream",
      assignmentIds: [],
    },
  } as unknown as OwnerReasoningContext;
  expect(supervisionReasoningDecisionSchema(context).properties.operation.enum).toEqual([
    "complete_workstream",
    "allocate_existing",
    "hire_worker",
    "request_team_support",
    "escalate",
  ]);
});

it("lets the principal proxy decide past the escalation bound without escalating again", () => {
  const context = {
    trigger: {
      reasonCode: "principal_proxy_worker_failed",
      nextAction: "revise_responsibility",
      assignmentIds: [],
    },
  } as unknown as OwnerReasoningContext;
  const operations = supervisionReasoningDecisionSchema(context).properties.operation.enum;
  expect(operations).toContain("revise_responsibility");
  expect(operations).toContain("allocate_existing");
  expect(operations).not.toContain("escalate");
});
