import { describe, expect, it } from "vitest";

import type { EventEnvelope } from "@lervo/schemas";

import { assignmentTopologyDigest, projectAssignmentTopologyHistory } from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const workstreamId = "wks_0123456789abcdef01234567";

function event(nodeKey: string, ordinal: number): EventEnvelope {
  const nodeSetHash = assignmentTopologyDigest(["left", "right"]);
  return {
    schemaVersion: 1,
    eventId: `evt_${String(ordinal).padStart(24, "0")}`,
    projectId: "prj_0123456789abcdef",
    runId: `run_${String(ordinal).padStart(24, "0")}`,
    sessionId: `ses_${String(ordinal).padStart(24, "0")}`,
    seq: ordinal,
    type: "assignment.created",
    occurredAt: `2026-09-07T00:00:0${ordinal}.000Z`,
    actor: { kind: "system" },
    policyVersion: hash("a"),
    payload: {
      assignmentId: `asn_${String(ordinal).repeat(24)}`,
      workstreamId,
      topologyContractVersion: 2,
      topologyChangeId: "gtc_111111111111111111111111",
      topologyChangeKey: "parallel_review",
      topologyPlanId: "gtp_222222222222222222222222",
      topologyApprovalHash: hash("b"),
      topologyReviewerIdDigest: hash("c"),
      topologyRequestHash: hash("d"),
      topologyExpectedNodeCount: 2,
      topologyNodeSetHash: nodeSetHash,
      topologyNodeKey: nodeKey,
    },
    previousHash: ordinal === 1 ? null : hash("e"),
    eventHash: hash("f"),
  };
}

describe("assignment topology history", () => {
  it("replays a complete reviewed change and exposes interrupted recovery", () => {
    const complete = projectAssignmentTopologyHistory({
      events: [event("left", 1), event("right", 2)],
      workstreamId,
    });
    expect(complete).toMatchObject({
      status: "valid",
      reasonCodes: [],
      changes: [{ changeId: "gtc_111111111111111111111111" }],
    });

    const interrupted = projectAssignmentTopologyHistory({
      events: [event("left", 1)],
      workstreamId,
    });
    expect(interrupted).toMatchObject({
      status: "recovery_required",
      reasonCodes: ["topology_change_incomplete"],
      changes: [],
    });
  });

  it("fails closed on malformed topology-marked history", () => {
    const malformed = event("left", 1);
    delete malformed.payload.topologyApprovalHash;
    expect(projectAssignmentTopologyHistory({ events: [malformed], workstreamId })).toMatchObject({
      status: "invalid",
      reasonCodes: ["topology_history_malformed"],
      changes: [],
    });
  });
});
