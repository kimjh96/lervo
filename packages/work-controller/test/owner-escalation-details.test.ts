import { describe, expect, it } from "vitest";

import {
  classifyOwnerEscalationDetails,
  validOwnerHandoffAcceptanceDetails,
} from "../src/owner-escalation-details.js";

describe("owner escalation detail variants", () => {
  it("keeps bounded explanatory evidence in the local-attention variant", () => {
    expect(
      classifyOwnerEscalationDetails({
        reasonCode: "four_task_scope_missing",
        neededDecision: "Identify the missing fourth work item and its deployment boundary.",
        observedNextActions: ["Diagnose capacity", "Activate the model", "Verify failures"],
      }),
    ).toEqual({ kind: "attention", reasonCode: "four_task_scope_missing" });
  });

  it("recognizes an exact scoped handoff separately", () => {
    const request = {
      objective: "Inspect one source policy",
      deliverables: ["Review"],
      acceptanceCriteria: ["Evidence-backed finding"],
      evidenceArtifactHashes: [],
    };
    const recipientProjectId = `prj_${"a".repeat(16)}`;
    expect(classifyOwnerEscalationDetails({ recipientProjectId, request })).toEqual({
      kind: "handoff",
      recipientProjectId,
      request,
    });
    expect(validOwnerHandoffAcceptanceDetails({ handoffHash: `sha256:${"a".repeat(64)}` })).toBe(
      true,
    );
  });

  it("rejects ambiguous, unbounded, and unknown fields without guessing a handoff", () => {
    for (const details of [
      { reasonCode: "scope_missing", recipientProjectId: "prj_other", request: {} },
      { reasonCode: "scope_missing", neededDecision: "x".repeat(1_025) },
      { reasonCode: "scope_missing", observedNextActions: [] },
      { neededDecision: "Please decide" },
      { recipientProjectId: "prj_other", request: {}, invented: true },
    ])
      expect(classifyOwnerEscalationDetails(details)).toEqual({ kind: "invalid" });
    expect(
      validOwnerHandoffAcceptanceDetails({
        handoffHash: `sha256:${"a".repeat(64)}`,
        extra: true,
      }),
    ).toBe(false);
  });
});
