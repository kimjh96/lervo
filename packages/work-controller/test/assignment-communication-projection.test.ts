import { describe, expect, it } from "vitest";

import { projectAssignmentCommunications } from "../src/index.js";

const projectId = "prj_fixture001";
const workstreamId = "wks_111111111111111111111111";
const assignmentId = "asn_111111111111111111111111";
const sourceAgentId = "agt_111111111111111111111111";
const recipientAgentId = "agt_222222222222222222222222";

function query(filters: { assignmentId?: string; recipientAgentId?: string } = {}) {
  return {
    schemaVersion: 1 as const,
    kind: "assignment_communication.inspect" as const,
    projectId,
    workstreamId,
    observedAt: "2026-09-02T00:02:00.000Z",
    assignmentId: filters.assignmentId ?? null,
    recipientAgentId: filters.recipientAgentId ?? null,
  };
}

function assignment(toAgentId = recipientAgentId) {
  return {
    assignmentId,
    projectId,
    workstreamId,
    revision: 3,
    status: "leased" as const,
    handoffs: [
      {
        handoffId: "hnd_111111111111111111111111",
        fromAgentId: sourceAgentId,
        toAgentId,
        requestDigest: `sha256:${"a".repeat(64)}`,
        artifactReferences: [
          { artifactId: "art_interaction01", contentHash: `sha256:${"b".repeat(64)}` },
        ],
        contextEvidenceEventIds: ["evt_interaction01"],
        createdAt: "2026-09-02T00:01:00.000Z",
      },
    ],
  };
}

const agents = [
  { agentId: sourceAgentId, status: "active" as const },
  { agentId: recipientAgentId, status: "suspended" as const },
];

describe("assignment communication projection", () => {
  it("projects content-free threads and inbox routes without inventing delivery", () => {
    const report = projectAssignmentCommunications({
      query: query(),
      assignments: [assignment()],
      agents,
    });

    expect(report.validity).toEqual({ status: "valid", reasonCodes: [] });
    expect(report.threads).toHaveLength(1);
    expect(report.threads[0]!.routes[0]).toMatchObject({
      routeState: "recorded",
      deliveryState: "unobserved",
      acknowledgementState: "unobserved",
      artifactReferences: [{ artifactId: "art_interaction01" }],
    });
    expect(report.inbox[0]).toMatchObject({
      recipientAgentId,
      recipientAgentStatus: "suspended",
      artifactCount: 1,
    });
    expect(JSON.stringify(report)).not.toContain("message body");
  });

  it("filters exact assignment and recipient coordinates", () => {
    const report = projectAssignmentCommunications({
      query: query({ assignmentId, recipientAgentId }),
      assignments: [assignment()],
      agents,
    });
    expect(report.threads.map((thread) => thread.assignmentId)).toEqual([assignmentId]);
    expect(report.inbox.map((item) => item.recipientAgentId)).toEqual([recipientAgentId]);

    const empty = projectAssignmentCommunications({
      query: query({ recipientAgentId: sourceAgentId }),
      assignments: [assignment()],
      agents,
    });
    expect(empty.threads).toEqual([]);
    expect(empty.inbox).toEqual([]);
  });

  it("keeps missing workforce identity explicit instead of routing by inference", () => {
    const missing = "agt_999999999999999999999999";
    const report = projectAssignmentCommunications({
      query: query(),
      assignments: [assignment(missing)],
      agents,
    });
    expect(report.validity).toEqual({
      status: "invalid",
      reasonCodes: ["handoff_recipient_agent_missing"],
    });
    expect(report.inbox[0]!.recipientAgentStatus).toBe("missing");
  });

  it("does not turn unknown query coordinates into an empty successful report", () => {
    const report = projectAssignmentCommunications({
      query: query({ assignmentId: "asn_999999999999999999999999" }),
      assignments: [assignment()],
      agents,
    });
    expect(report.validity).toEqual({
      status: "invalid",
      reasonCodes: ["assignment_not_found"],
    });
  });
});
