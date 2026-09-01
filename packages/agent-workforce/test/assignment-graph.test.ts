import { describe, expect, it } from "vitest";

import {
  evaluateWorkforceAdmission,
  planAssignmentCancellation,
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
