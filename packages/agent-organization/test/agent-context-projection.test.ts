import { describe, expect, it } from "vitest";

import { AgentContextError, projectAgentContext } from "../src/index.js";

const projectId = "prj_context0001";
const ownerAgentId = `agt_${"a".repeat(24)}`;
const successorAgentId = `agt_${"b".repeat(24)}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const agents = [
  {
    agentId: ownerAgentId,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: hash("a"),
    roleProfileHash: hash("b"),
    provider: "any" as const,
    responsibilityPaths: ["."],
    parentAgentId: null,
    status: "retired" as const,
  },
  {
    agentId: successorAgentId,
    roleId: "researcher",
    roleVersion: "1.0.0",
    roleContractHash: hash("c"),
    roleProfileHash: hash("d"),
    provider: "claude" as const,
    responsibilityPaths: ["docs"],
    parentAgentId: ownerAgentId,
    status: "active" as const,
  },
];

const source = {
  projectId,
  seq: 1,
  type: "run.completed",
  payload: {},
  eventId: "evt_source0001",
  eventHash: hash("1"),
};
const review = {
  projectId,
  seq: 2,
  type: "knowledge.verified",
  payload: { candidateContentHash: hash("4") },
  eventId: "evt_review0001",
  eventHash: hash("2"),
};
const entryId = `actx_${"3".repeat(24)}`;
const promotion = {
  projectId,
  seq: 3,
  type: "agent.context.promoted",
  payload: {
    contextEntryId: entryId,
    agentId: ownerAgentId,
    layer: "expertise",
    memoryKind: "expertise",
    subjectKey: "provider-boundary",
    audience: "agent",
    sensitivity: "internal",
    confidence: "high",
    retrievalDigests: [hash("7")],
    observedAt: "2026-09-08T00:00:00.000Z",
    expiresAt: null,
    reviewBindingVersion: 2,
    source: { kind: "event", sourceId: source.eventId, contentHash: source.eventHash },
    summaryArtifactId: `art_${"4".repeat(64)}`,
    summaryContentHash: hash("4"),
    summaryByteCount: 18,
    reviewEventId: review.eventId,
    reviewEventHash: review.eventHash,
    supersedesContextEntryId: null,
    promotedAt: "2026-09-09T00:00:00.000Z",
  },
};
const handoff = {
  projectId,
  seq: 4,
  type: "agent.context.handoff.recorded",
  payload: {
    contextHandoffId: `ach_${"5".repeat(24)}`,
    fromAgentId: ownerAgentId,
    toAgentId: successorAgentId,
    contextEntryIds: [entryId],
    manifestArtifactId: `art_${"6".repeat(64)}`,
    manifestContentHash: hash("6"),
    manifestByteCount: 128,
    recordedAt: "2026-09-09T00:01:00.000Z",
  },
};

describe("agent context projection", () => {
  it("keeps retired context read-only and gives successors only explicit handoffs", () => {
    const events = [source, review, promotion, handoff];
    const owner = projectAgentContext({ projectId, agentId: ownerAgentId, agents, events });
    const successor = projectAgentContext({
      projectId,
      agentId: successorAgentId,
      agents,
      events,
    });

    expect(owner).toMatchObject({ readOnly: true, entries: [{ contextEntryId: entryId }] });
    expect(successor.entries).toEqual([]);
    expect(successor.inheritedEntries).toEqual([
      expect.objectContaining({ contextEntryId: entryId, agentId: ownerAgentId }),
    ]);
    expect(successor.incomingHandoffs).toHaveLength(1);
  });

  it("rejects promotion without exact qualifying review evidence", () => {
    expect(() =>
      projectAgentContext({
        projectId,
        agentId: ownerAgentId,
        agents,
        events: [source, { ...promotion, seq: 2 }],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentContextError>>({
        code: "agent_context_state_conflict",
      }),
    );
  });

  it("rejects failed verification as promotion review evidence", () => {
    const failedReview = {
      ...review,
      type: "verification.completed",
      payload: { status: "failed", resultContentHash: hash("4") },
    };
    expect(() =>
      projectAgentContext({
        projectId,
        agentId: ownerAgentId,
        agents,
        events: [source, failedReview, promotion],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentContextError>>({
        code: "agent_context_state_conflict",
      }),
    );
  });
});
