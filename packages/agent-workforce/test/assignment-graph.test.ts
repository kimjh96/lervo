import { describe, expect, it } from "vitest";

import {
  createAssignmentCancellationPlan,
  evaluateWorkforceAdmission,
  planAssignmentCancellation,
  type WorkforceAssignment,
  workforceLimits,
} from "../src/index.js";

function assignment(
  assignmentId: string,
  dependencyIds: string[],
  status: "queued" | "leased" | "blocked" | "completed" | "failed" | "cancelled" = "queued",
) {
  return { assignmentId, dependencyIds, status };
}

describe("assignment graph safety", () => {
  it("plans bounded deterministic cancellation through every dependent branch", () => {
    const root = "asn_000000000000000000000001";
    const left = "asn_000000000000000000000002";
    const right = "asn_000000000000000000000003";
    const join = "asn_000000000000000000000004";
    expect(
      planAssignmentCancellation({
        assignments: [
          assignment(join, [left, right]),
          assignment(right, [root]),
          assignment(root, []),
          assignment(left, [root]),
        ],
        requestedAssignmentIds: [root],
      }),
    ).toEqual([
      { assignmentId: root, reason: "requested" },
      { assignmentId: left, reason: "dependency_cancelled" },
      { assignmentId: right, reason: "dependency_cancelled" },
      { assignmentId: join, reason: "dependency_cancelled" },
    ]);
  });

  it("does not rewrite terminal descendants and rejects unknown roots", () => {
    const root = "asn_000000000000000000000001";
    const complete = "asn_000000000000000000000002";
    expect(
      planAssignmentCancellation({
        assignments: [assignment(root, []), assignment(complete, [root], "completed")],
        requestedAssignmentIds: [root],
      }),
    ).toEqual([{ assignmentId: root, reason: "requested" }]);
    expect(() =>
      planAssignmentCancellation({
        assignments: [assignment(root, [])],
        requestedAssignmentIds: [complete],
      }),
    ).toThrow("unknown assignment");
  });

  it("binds a single cancellation plan to revision, state, and cancelled dependency evidence", () => {
    const root = {
      ...assignment("asn_000000000000000000000001", [], "cancelled"),
      revision: 2,
    } as WorkforceAssignment;
    const dependent = {
      ...assignment("asn_000000000000000000000002", [root.assignmentId]),
      revision: 1,
    } as WorkforceAssignment;
    const plan = createAssignmentCancellationPlan({
      assignments: [root, dependent],
      assignmentId: dependent.assignmentId,
      reason: "dependency_cancelled",
    });
    expect(plan).toMatchObject({
      status: "ready",
      expectedRevision: 1,
      cancelledDependencyIds: [root.assignmentId],
      planId: expect.stringMatching(/^acp_[a-f0-9]{24}$/u),
    });
    expect(
      createAssignmentCancellationPlan({
        assignments: [{ ...dependent, status: "leased", revision: 2 }],
        assignmentId: dependent.assignmentId,
        reason: "requested",
      }),
    ).toMatchObject({ status: "blocked", blockedReason: "active_lease" });
    const leased = (expiresAt: string) =>
      ({
        ...dependent,
        status: "leased",
        revision: 2,
        lease: { expiresAt },
      }) as unknown as WorkforceAssignment;
    const now = new Date("2026-09-25T00:00:00.000Z");
    // An expired lease can no longer commit a result, so it no longer blocks cancellation.
    expect(
      createAssignmentCancellationPlan({
        assignments: [leased("2026-09-24T16:04:55.156Z")],
        assignmentId: dependent.assignmentId,
        reason: "requested",
        now,
      }),
    ).toMatchObject({ status: "ready", blockedReason: null, previousStatus: "leased" });
    expect(
      createAssignmentCancellationPlan({
        assignments: [leased("2026-09-25T00:05:00.000Z")],
        assignmentId: dependent.assignmentId,
        reason: "requested",
        now,
      }),
    ).toMatchObject({ status: "blocked", blockedReason: "active_lease" });
  });

  it("ends a live lease only when the caller names its exact holder", () => {
    const now = new Date("2026-11-27T00:00:00.000Z");
    const holder = { agentId: `agt_${"a".repeat(24)}`, leaseId: `lse_${"b".repeat(24)}` };
    const leased = {
      ...assignment("asn_000000000000000000000001", [], "leased"),
      revision: 3,
      lease: { ...holder, expiresAt: "2026-11-27T00:10:00.000Z" },
    } as unknown as WorkforceAssignment;
    const plan = (named?: typeof holder) =>
      createAssignmentCancellationPlan({
        assignments: [leased],
        assignmentId: leased.assignmentId,
        reason: "requested",
        now,
        ...(named === undefined ? {} : { holder: named }),
      });
    expect(plan()).toMatchObject({ status: "blocked", blockedReason: "active_lease" });
    expect(plan()).not.toHaveProperty("holder");
    expect(plan(holder)).toMatchObject({ status: "ready", blockedReason: null, holder });
    // The holder is part of what the plan binds, so its ID differs from an unbound plan's.
    expect(plan(holder).planId).not.toBe(plan().planId);
    for (const other of [
      { ...holder, leaseId: `lse_${"c".repeat(24)}` },
      { ...holder, agentId: `agt_${"d".repeat(24)}` },
    ])
      expect(plan(other)).toMatchObject({ status: "blocked", blockedReason: "active_lease" });
  });

  it("reports each capacity and backpressure boundary without mutation", () => {
    expect(
      evaluateWorkforceAdmission({
        currentAgents: workforceLimits.maximumAgents,
        currentAssignments: 0,
        activeLeases: 0,
        requestedAgents: 1,
      }),
    ).toEqual({ status: "rejected", reason: "agent_capacity" });
    expect(
      evaluateWorkforceAdmission({
        currentAgents: 4,
        currentAssignments: 20,
        activeLeases: 4,
        requestedAgents: 2,
        requestedAssignments: 8,
        requestedFanout: 4,
        requestedIntegrationBatch: 8,
        delegationDepth: 2,
      }),
    ).toEqual({ status: "admitted" });
    expect(
      evaluateWorkforceAdmission({
        currentAgents: 1,
        currentAssignments: 1,
        activeLeases: 0,
        requestedIntegrationBatch: workforceLimits.maximumIntegrationBatch + 1,
      }),
    ).toEqual({ status: "rejected", reason: "integration_batch_capacity" });
  });
});
