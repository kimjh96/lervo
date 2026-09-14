import { expect, it } from "vitest";

import {
  assertResponsibilityGoalCurrent,
  staleResponsibilityFacts,
} from "../src/supervision-goal-revision.js";

function source(input: {
  revision: number;
  bindings: { assignmentId: string; boundRevision: number; status?: string; lease?: boolean }[];
  started?: string[];
}) {
  return {
    workstream: { revision: input.revision },
    assignments: input.bindings.map((item) => ({
      assignmentId: item.assignmentId,
      status: item.status ?? "leased",
      lease: item.lease === false ? null : { expiresAt: "2026-09-14T13:13:16.879Z" },
    })),
    responsibilities: input.bindings.map((item) => ({
      assignmentId: item.assignmentId,
      binding: {
        workstreamRevision: item.boundRevision,
        responsibility: { executorAgentId: `agt_${"f".repeat(24)}` },
      },
    })),
    execution: {
      attempts: (input.started ?? []).map((assignmentId) => ({ assignmentId })),
    },
  } as never;
}

it("lists only non-terminal responsibilities bound before the current goal revision", () => {
  const facts = staleResponsibilityFacts(
    source({
      revision: 2,
      bindings: [
        { assignmentId: `asn_${"a".repeat(24)}`, boundRevision: 1 },
        { assignmentId: `asn_${"b".repeat(24)}`, boundRevision: 2 },
        { assignmentId: `asn_${"c".repeat(24)}`, boundRevision: 1, status: "completed" },
        { assignmentId: `asn_${"d".repeat(24)}`, boundRevision: 1, lease: false },
      ],
      started: [`asn_${"d".repeat(24)}`],
    }),
  );
  expect(facts).toEqual([
    {
      assignmentId: `asn_${"a".repeat(24)}`,
      executorAgentId: `agt_${"f".repeat(24)}`,
      boundWorkstreamRevision: 1,
      currentWorkstreamRevision: 2,
      leaseExpiresAt: "2026-09-14T13:13:16.879Z",
      started: false,
    },
    {
      assignmentId: `asn_${"d".repeat(24)}`,
      executorAgentId: `agt_${"f".repeat(24)}`,
      boundWorkstreamRevision: 1,
      currentWorkstreamRevision: 2,
      leaseExpiresAt: null,
      started: true,
    },
  ]);
});

it("still exposes the stale check for a stale responsibility only", () => {
  const stale = source({
    revision: 3,
    bindings: [{ assignmentId: `asn_${"a".repeat(24)}`, boundRevision: 1 }],
  });
  expect(() => assertResponsibilityGoalCurrent(stale, `asn_${"a".repeat(24)}`)).toThrow(
    /bound under goal revision 1; the goal is now revision 3/u,
  );
  const current = source({
    revision: 3,
    bindings: [{ assignmentId: `asn_${"a".repeat(24)}`, boundRevision: 3 }],
  });
  expect(() => assertResponsibilityGoalCurrent(current, `asn_${"a".repeat(24)}`)).not.toThrow();
  expect(() => assertResponsibilityGoalCurrent(stale, `asn_${"b".repeat(24)}`)).not.toThrow();
});
