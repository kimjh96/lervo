import { roomMentionRecordedEventId } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { AgentContextError, conversationNoteSubject, projectAgentContext } from "../src/index.js";

const projectId = "prj_context0001";
const ciel = `agt_${"c".repeat(24)}`;
const elio = `agt_${"d".repeat(24)}`;
const workspace = `wsp_${"e".repeat(24)}`;
const elsewhere = `wsp_${"f".repeat(24)}`;
const mentionId = `mnt_${"1".repeat(24)}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const agent = (agentId: string) => ({
  agentId,
  roleId: "developer",
  roleVersion: "1.0.0",
  roleContractHash: hash("a"),
  roleProfileHash: hash("b"),
  provider: "claude" as const,
  responsibilityPaths: ["."],
  parentAgentId: null,
  status: "active" as const,
});
const agents = [agent(ciel), agent(elio)];

const recorded = (toAgentId = ciel, workspaceId = workspace) => ({
  projectId,
  seq: 1,
  type: "room.mention.recorded",
  payload: {
    workspaceId,
    mentionId,
    fromAgentId: elio,
    toAgentId,
    depth: 1,
    occurredAt: "2026-11-27T02:59:00.000Z",
  },
  eventId: roomMentionRecordedEventId(mentionId),
  eventHash: hash("2"),
});
const delivered = (occurredAt = "2026-11-27T03:00:00.000Z") => ({
  projectId,
  seq: 2,
  type: "room.mention.delivered",
  payload: { mentionId, providerSessionDigest: hash("3"), occurredAt },
  eventId: "evt_delivered0001",
  eventHash: hash("4"),
});

type NoteChanges = Record<string, unknown>;
const note = (seq: number, changes: NoteChanges = {}, entry = "5") => ({
  projectId,
  seq,
  type: "agent.context.promoted",
  payload: {
    contextEntryId: `actx_${entry.repeat(24)}`,
    agentId: ciel,
    layer: "work",
    memoryKind: "conversation_note",
    subjectKey: conversationNoteSubject(workspace, "retries"),
    audience: "agent",
    sensitivity: "internal",
    confidence: "medium",
    retrievalDigests: [hash("7")],
    observedAt: "2026-11-27T03:00:30.000Z",
    expiresAt: "2026-12-27T03:01:00.000Z",
    reviewBindingVersion: 2,
    source: { kind: "event", sourceId: "evt_delivered0001", contentHash: hash("4") },
    summaryArtifactId: `art_${"8".repeat(64)}`,
    summaryContentHash: hash("8"),
    summaryByteCount: 40,
    reviewEventId: "evt_delivered0001",
    reviewEventHash: hash("4"),
    supersedesContextEntryId: null,
    promotedAt: "2026-11-27T03:01:00.000Z",
    ...changes,
  },
});

const project = (events: readonly { seq: number }[]) =>
  projectAgentContext({ projectId, agentId: ciel, agents, events: events as never });
const refused = (events: readonly { seq: number }[]) => {
  expect(() => project(events)).toThrow(AgentContextError);
};

describe("a conversation note's provenance", () => {
  it("is attested by its own delivery's receipt, in the conversation it names", () => {
    const projection = project([recorded(), delivered(), note(3)]);
    expect(projection.entries).toEqual([
      expect.objectContaining({ memoryKind: "conversation_note", status: "active" }),
    ]);
  });

  it("refuses a receipt that does not bind this agent, conversation, and time", () => {
    refused([recorded(elio), delivered(), note(3)]);
    refused([recorded(ciel, elsewhere), delivered(), note(3)]);
    refused([recorded(), delivered("2026-11-27T03:02:00.000Z"), note(3)]);
    // A receipt whose mention was never recorded attests nothing.
    refused([{ ...delivered(), seq: 1 }, note(2)]);
  });

  it("keeps the branch to self-reported, expiring work notes", () => {
    refused([recorded(), delivered(), note(3, { confidence: "high" })]);
    refused([recorded(), delivered(), note(3, { layer: "expertise" })]);
    refused([recorded(), delivered(), note(3, { expiresAt: null })]);
    refused([recorded(), delivered(), note(3, { sensitivity: "restricted" })]);
    // Another kind with a receipt as its review still needs a review of its exact words.
    refused([recorded(), delivered(), note(3, { memoryKind: "work_outcome" })]);
    // A note whose review is no receipt is refused, however it binds its words.
    const verified = {
      projectId,
      seq: 3,
      type: "knowledge.verified",
      payload: { candidateContentHash: hash("8") },
      eventId: "evt_verified0001",
      eventHash: hash("9"),
    };
    refused([
      recorded(),
      delivered(),
      verified,
      note(4, { reviewEventId: verified.eventId, reviewEventHash: verified.eventHash }),
    ]);
  });

  it("lets one receipt attest one note, and never hands a note to another agent", () => {
    refused([
      recorded(),
      delivered(),
      note(3),
      note(4, { subjectKey: conversationNoteSubject(workspace, "budget") }, "6"),
    ]);
    const handoff = {
      projectId,
      seq: 4,
      type: "agent.context.handoff.recorded",
      payload: {
        contextHandoffId: `ach_${"7".repeat(24)}`,
        fromAgentId: ciel,
        toAgentId: elio,
        contextEntryIds: [`actx_${"5".repeat(24)}`],
        manifestArtifactId: `art_${"a".repeat(64)}`,
        manifestContentHash: hash("a"),
        recordedAt: "2026-11-27T03:02:00.000Z",
      },
    };
    refused([recorded(), delivered(), note(3), handoff]);
  });
});
