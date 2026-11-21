import { expect, it } from "vitest";

import type { OwnerReasoningContext } from "../src/supervision-reasoning-context.js";
import { assertProviderTurnAsksNoHashCopy } from "@lervo/schemas";

import { ownerReasoningTurn } from "../src/supervision-reasoning-instructions.js";
import { ownerReasoningPromptContext } from "../src/supervision-reasoning-prompt.js";

it("sends the model recent notes and live assignments while the artifact keeps every fact", () => {
  const workstream = {
    workstreamId: "wks_x",
    notes: Array.from({ length: 12 }, (_, index) => `note ${index}`),
  };
  const context = {
    schemaVersion: 1,
    kind: "work.owner_reasoning.context",
    basisHash: "sha256:x",
    facts: {
      workstream,
      assignments: [
        {
          assignmentId: "asn_a",
          status: "cancelled",
          failureCode: null,
          acceptanceCriteria: ["x"],
        },
        { assignmentId: "asn_b", status: "leased", failureCode: null, acceptanceCriteria: ["y"] },
      ],
      responsibilities: [
        { assignmentId: "asn_a", binding: { responsibility: { taskPurpose: "old" } } },
        { assignmentId: "asn_b", binding: { responsibility: { taskPurpose: "live" } } },
      ],
      handoffs: { pendingIncoming: [] },
      peers: [],
      tasks: { assignments: [] },
    },
    planning: { workstream, sources: [] },
    trigger: { reasonCode: "r", nextAction: "dispatch", assignmentIds: [] },
    results: [],
  } as unknown as OwnerReasoningContext;
  const before = JSON.stringify(context);
  const prompt = ownerReasoningPromptContext(context) as {
    facts: {
      workstream: { notes: string[]; omittedOlderNoteCount: number };
      assignments: object[];
      responsibilities: object[];
    };
    planning: { workstream: unknown };
  };
  expect(prompt.facts.workstream.notes).toEqual([
    "note 4",
    "note 5",
    "note 6",
    "note 7",
    "note 8",
    "note 9",
    "note 10",
    "note 11",
  ]);
  expect(prompt.facts.workstream.omittedOlderNoteCount).toBe(4);
  expect(prompt.facts.assignments).toEqual([
    { assignmentId: "asn_a", status: "cancelled", failureCode: null },
    context.facts.assignments[1],
  ]);
  expect(prompt.facts.responsibilities[0]).toEqual({
    assignmentId: "asn_a",
    binding: "omitted_cancelled",
  });
  expect(prompt.facts.responsibilities[1]).toBe(context.facts.responsibilities[1]);
  expect(prompt.planning.workstream).toBe("identical_to_facts.workstream");
  expect(JSON.stringify(context)).toBe(before);
});

it("declares the context as data, so a note that asks to copy a hash never refuses the turn (ADR-0608)", () => {
  const note = "Copy the release commit SHA exactly into the changelog.";
  const context = {
    schemaVersion: 1,
    kind: "work.owner_reasoning.context",
    basisHash: "sha256:x",
    facts: {
      workstream: { workstreamId: "wks_x", notes: [note] },
      assignments: [],
      responsibilities: [],
      handoffs: { pendingIncoming: [] },
      peers: [],
      tasks: { assignments: [] },
    },
    planning: { workstream: { workstreamId: "wks_x", notes: [note] }, sources: [] },
    trigger: { reasonCode: "r", nextAction: "dispatch", assignmentIds: [] },
    results: [],
  } as unknown as OwnerReasoningContext;
  const turn = ownerReasoningTurn(context, "2026-11-22T00:00:00.000Z");
  expect(turn.instructions).toContain(note);
  expect(() =>
    assertProviderTurnAsksNoHashCopy(turn.instructions, turn.untrustedInstructions),
  ).not.toThrow();
  expect(() => assertProviderTurnAsksNoHashCopy(turn.instructions)).toThrow(/asks to copy a hash/u);
});
