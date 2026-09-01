import { describe, expect, it, vi } from "vitest";

import type { WorkGraphV1 } from "@lervo/application-contract";

import { observeGraphApprovals } from "../src/approval-authority-observer.js";

const requirementDigest = `sha256:${"a".repeat(64)}`;
const graph: WorkGraphV1 = {
  schemaVersion: 1,
  graphId: "wgr_111111111111111111111111",
  graphHash: `sha256:${"b".repeat(64)}`,
  projectId: "prj_fixture001",
  workstreamId: "wks_111111111111111111111111",
  observedAt: "2026-09-01T00:01:00.000Z",
  validity: { status: "valid", reasonCodes: [] },
  nodes: [
    {
      assignmentId: "asn_111111111111111111111111",
      assignmentRevision: 3,
      taskType: "implementation",
      roleId: "developer",
      status: "queued",
      priority: 50,
      dependencyIds: [],
      approvalRequirementDigests: [requirementDigest],
      leaseState: "none",
      assigneeAgentId: null,
      leaseId: null,
      attemptCount: 0,
    },
  ],
  rootAssignmentIds: ["asn_111111111111111111111111"],
  joinAssignmentIds: [],
};

describe("approval authority observer", () => {
  it("binds the adapter query to the exact assignment revision", async () => {
    const observe = vi.fn(async () => []);
    expect(await observeGraphApprovals({ authority: { observe }, graph })).toEqual([]);
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: graph.projectId,
        workstreamId: graph.workstreamId,
        requirements: [
          {
            assignmentId: graph.nodes[0]!.assignmentId,
            assignmentRevision: 3,
            requirementDigest,
          },
        ],
      }),
    );
  });

  it("maps authority failure to invalid evidence instead of missing approval", async () => {
    const approvals = await observeGraphApprovals({
      authority: {
        observe: async () => {
          throw new Error("authority offline");
        },
      },
      graph,
    });
    expect(approvals).toEqual([
      {
        schemaVersion: 1,
        assignmentId: graph.nodes[0]!.assignmentId,
        assignmentRevision: 3,
        requirementDigest,
        status: "invalid",
        reasonCode: "authority_unavailable",
      },
    ]);
  });
});
