import { expect, it } from "vitest";

import {
  supervisionAttentionHealth,
  supervisionAttentionReasonCodes,
  supervisionCycleHealth,
  supervisionEvidenceReadFailureLine,
  supervisionEffectFailureLine,
} from "../src/supervision-attention-health.js";
import { NodeSupervisionError } from "../src/supervision-authority.js";

it("reports a goal budget stop as bounded attention without degrading the Node", () => {
  const resourceBudget = {
    schemaVersion: 1 as const,
    scope: "goal" as const,
    limitTokens: 1_000,
    observedTokens: 850,
    reservedTokens: 50,
    requestedTokens: 200,
    remainingTokens: 100,
  };
  expect(
    supervisionAttentionHealth({
      reasonCodes: ["aggregate_budget_exceeded"],
      resourceBudget,
    }),
  ).toEqual({
    status: "attention",
    reasonCode: "goal_budget_insufficient",
    resourceBudget,
  });
  expect(
    supervisionAttentionHealth({
      reasonCodes: ["aggregate_budget_exceeded"],
      resourceBudget: { ...resourceBudget, scope: "workstream" },
    }),
  ).toEqual({
    status: "unavailable",
    failureCode: "supervision_attention_required",
    reasonCodes: ["aggregate_budget_exceeded"],
  });
});

it("preserves unavailable publication diagnostics without inferring a local origin", () => {
  expect(
    supervisionAttentionReasonCodes({ nextAction: "publish_result" }, ["owner_plan_unavailable"]),
  ).toEqual(["owner_plan_unavailable"]);
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

it("parks only an inactive bound workstream and keeps other cycle failures unavailable", () => {
  expect(
    supervisionCycleHealth(new NodeSupervisionError("supervision_workstream_inactive")),
  ).toEqual({ status: "dormant", reasonCode: "workstream_inactive" });
  expect(
    supervisionCycleHealth(
      Object.assign(new Error("Untrusted matching code."), {
        code: "supervision_workstream_inactive",
      }),
    ),
  ).toEqual({
    status: "unavailable",
    failureCode: "supervision_cycle_failed",
    reasonCodes: ["supervision_workstream_inactive"],
  });
  expect(
    supervisionCycleHealth(
      Object.assign(new Error("Authority changed."), { code: "supervision_authority_changed" }),
    ),
  ).toEqual({
    status: "unavailable",
    failureCode: "supervision_cycle_failed",
    reasonCodes: ["supervision_authority_changed"],
  });
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

it("records a bundle coordinate without exposing its host path", async () => {
  const { supervisionCycleFailureLine } = await import("../src/supervision-attention-health.js");
  const failure = new NodeSupervisionError("supervision_authority_changed");
  failure.stack = `${failure.name}: ${failure.message}\n    at observeAuthority (/private/host/dist/bin.js:123:45)`;
  const line = supervisionCycleFailureLine(failure);
  expect(line).toContain("origin=bin.js:123:45");
  expect(line).not.toContain("/private/host");
});

it("records bounded recovery evidence diagnostics without changing the failure state", () => {
  const error = Object.assign(new Error("unavailable\nsource"), {
    code: "supervision_authority_changed",
  });
  expect(supervisionEvidenceReadFailureLine(error)).toBe(
    "Lervo supervision evidence unavailable (supervision_authority_changed): Error: unavailable source [supervision_authority_changed]",
  );
});

it("names the wrapped cause of an uncertain effect", () => {
  const error = Object.assign(
    new Error("The workforce event failed and state was restored.", {
      cause: new Error("The assignment event chain is invalid."),
    }),
    { code: "workforce_write_failed" },
  );
  expect(
    supervisionEffectFailureLine(
      { actionKind: "allocate_existing", effectContract: "assignment.topology.materialize.v1" },
      error,
    ),
  ).toBe(
    "Lervo supervision effect uncertain (allocate_existing assignment.topology.materialize.v1): Error: The workforce event failed and state was restored. <- Error: The assignment event chain is invalid. [workforce_write_failed]",
  );
});
