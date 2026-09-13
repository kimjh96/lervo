import { describe, expect, it } from "vitest";
import { evaluateResponsibilityClaim } from "../src/index.js";
import { hash, now, responsibility } from "./operating-supervision.fixture.js";

function fixture() {
  const task = responsibility();
  return {
    source: {
      ...task,
      revision: task.assignmentRevision,
      expectedPaths: ["src"],
      liveLease: false,
    },
    responsibility: { ...task, assignmentRevision: task.assignmentRevision + 1 },
    maximumDeadlineMs: 3600_000,
    now,
  };
}

describe("responsibility claim transition admission", () => {
  it("binds the resulting revision while preserving source scope and acceptance", () => {
    expect(evaluateResponsibilityClaim(fixture())).toEqual({ status: "ready", reasonCodes: [] });
  });

  it.each([
    ["assignmentRevision", 1, "assignment_claim_revision_changed"],
    ["roleContractHash", hash("b"), "role_binding_changed"],
    ["expectedPaths", ["src-other/private.ts"], "assignment_claim_scope_changed"],
    ["acceptanceCriteria", ["A weaker result."], "assignment_claim_scope_changed"],
    ["verificationSuiteIds", ["save.weaker"], "assignment_claim_scope_changed"],
    ["predecessorBindingHash", hash("b"), "responsibility_changed"],
    ["startDeadline", now, "deadline_outside_mandate"],
  ] as const)("rejects changed %s", (field, value, reason) => {
    const input = fixture();
    Object.assign(input.responsibility, { [field]: value });
    expect(evaluateResponsibilityClaim(input).reasonCodes).toContain(reason);
  });

  it("does not allow a live lease to be replaced even by an identical executor", () => {
    const input = fixture();
    input.source.liveLease = true;
    expect(evaluateResponsibilityClaim(input).reasonCodes).toContain(
      "responsibility_lease_unresolved",
    );
  });

  it("limits the completion deadline by the actual mandate", () => {
    const input = fixture();
    input.maximumDeadlineMs = 60_000;
    expect(evaluateResponsibilityClaim(input).reasonCodes).toContain("deadline_outside_mandate");
  });
});
