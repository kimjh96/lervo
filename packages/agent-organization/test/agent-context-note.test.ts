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

type Changes = Record<string, unknown>;

const recorded = (changes: Changes = {}, seq = 1) => ({
  projectId,
  seq,
  type: "room.mention.recorded",
  payload: {
    workspaceId: workspace,
    mentionId,
    fromAgentId: elio,
    toAgentId: ciel,
    depth: 1,
    occurredAt: "2026-11-27T02:59:00.000Z",
    ...changes,
  },
  eventId: roomMentionRecordedEventId(mentionId),
  eventHash: hash("2"),
});
const delivered = (occurredAt = "2026-11-27T03:00:00.000Z", seq = 2) => ({
  projectId,
  seq,
  type: "room.mention.delivered",
  payload: { mentionId, providerSessionDigest: hash("3"), occurredAt },
  eventId: "evt_delivered0001",
  eventHash: hash("4"),
});

const note = (seq: number, changes: Changes = {}, entry = "5") => ({
  projectId,
  seq,
  type: "agent.context.promoted",
  payload: {
    contextEntryId: `actx_${entry.repeat(24)}`,
    agentId: ciel,
    layer: "work",
    memoryKind: "conversation_note",
    subjectKey: conversationNoteSubject(workspace, mentionId),
    audience: "agent",
    sensitivity: "internal",
    confidence: "medium",
    retrievalDigests: [hash("7")],
    observedAt: "2026-11-27T03:00:30.000Z",
    expiresAt: "2026-12-27T03:00:30.000Z",
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

/** A work outcome a passed verification attests, as reviewed memory. */
const verified = {
  projectId,
  seq: 3,
  type: "knowledge.verified",
  payload: { candidateContentHash: hash("9") },
  eventId: "evt_verified0001",
  eventHash: hash("a"),
};
const outcome = (seq: number) => ({
  ...note(seq, {}, "6"),
  payload: {
    ...note(seq, {}, "6").payload,
    memoryKind: "work_outcome",
    subjectKey: "retry-budget",
    confidence: "high",
    expiresAt: null,
    source: { kind: "event", sourceId: verified.eventId, contentHash: verified.eventHash },
    summaryArtifactId: `art_${"9".repeat(64)}`,
    summaryContentHash: hash("9"),
    reviewEventId: verified.eventId,
    reviewEventHash: verified.eventHash,
  },
});

const project = (events: readonly { seq: number }[]) =>
  projectAgentContext({ projectId, agentId: ciel, agents, events: events as never });
const refused = (events: readonly { seq: number }[]) => {
  expect(() => project(events)).toThrow(AgentContextError);
};

describe("a conversation note's provenance", () => {
  it("is attested by its own delivery's receipt, in the conversation and mention it names", () => {
    const projection = project([recorded(), delivered(), note(3)]);
    expect(projection.entries).toEqual([
      expect.objectContaining({ memoryKind: "conversation_note", status: "active" }),
    ]);
    expect(conversationNoteSubject(workspace, mentionId)).toBe(
      `conversation/${"e".repeat(24)}/${"1".repeat(24)}`,
    );
  });

  it("refuses a receipt that does not bind this agent, conversation, mention, and time", () => {
    refused([recorded({ toAgentId: elio }), delivered(), note(3)]);
    refused([recorded({ workspaceId: elsewhere }), delivered(), note(3)]);
    refused([recorded(), delivered("2026-11-27T03:02:00.000Z"), note(3)]);
    // A note observed before its delivery, or naming another mention, is not its answer.
    refused([recorded(), delivered(), note(3, { observedAt: "2026-11-27T02:59:30.000Z" })]);
    refused([
      recorded(),
      delivered(),
      note(3, { subjectKey: conversationNoteSubject(workspace, `mnt_${"2".repeat(24)}`) }),
    ]);
    // A source that is not the receipt, or a receipt whose mention was never recorded.
    refused([
      recorded(),
      delivered(),
      note(3, { source: { kind: "event", sourceId: "evt_other0001", contentHash: hash("4") } }),
    ]);
    refused([{ ...delivered(), seq: 1 }, note(2)]);
  });

  it("binds only a mention from another agent", () => {
    // An owner's mention has no agent, and an agent cannot mint receipts by mentioning itself.
    refused([recorded({ fromAgentId: null }), delivered(), note(3)]);
    refused([recorded({ fromAgentId: ciel }), delivered(), note(3)]);
  });

  it("orders mention, receipt, and note by sequence, at any head", () => {
    refused([note(1), recorded({}, 2), delivered(undefined, 3)]);
    refused([delivered(undefined, 1), recorded({}, 2), note(3)]);
  });

  it("keeps the branch to self-reported work notes that expire within 30 days", () => {
    refused([recorded(), delivered(), note(3, { confidence: "high" })]);
    refused([recorded(), delivered(), note(3, { layer: "expertise" })]);
    refused([recorded(), delivered(), note(3, { expiresAt: null })]);
    refused([recorded(), delivered(), note(3, { expiresAt: "9999-12-31T00:00:00.000Z" })]);
    refused([recorded(), delivered(), note(3, { expiresAt: "2026-12-27T03:00:31.000Z" })]);
    refused([recorded(), delivered(), note(3, { summaryByteCount: 2_049 })]);
    expect(
      project([recorded(), delivered(), note(3, { summaryByteCount: 2_048 })]).entries,
    ).toHaveLength(1);
    refused([recorded(), delivered(), note(3, { sensitivity: "restricted" })]);
    // A plain-word subject could carry conversation text; only identifiers are taken.
    refused([
      recorded(),
      delivered(),
      note(3, { subjectKey: `conversation/${"e".repeat(24)}/retries` }),
    ]);
    // Another kind with a receipt as its review still needs a review of its exact words.
    refused([recorded(), delivered(), note(3, { memoryKind: "work_outcome" })]);
    // A note whose review is no receipt is refused, however it binds its words.
    refused([
      recorded(),
      delivered(),
      verified,
      note(4, { reviewEventId: verified.eventId, reviewEventHash: verified.eventHash }),
    ]);
  });

  it("supersedes only another note, never reviewed memory", () => {
    const later = { ...delivered("2026-11-27T03:05:00.000Z", 5), eventId: "evt_delivered0002" };
    const second = `mnt_${"3".repeat(24)}`;
    const secondRecorded = {
      ...recorded({ mentionId: second }, 4),
      eventId: roomMentionRecordedEventId(second),
    };
    const secondDelivered = { ...later, payload: { ...later.payload, mentionId: second } };
    const replacing = (supersedes: string) =>
      note(
        6,
        {
          subjectKey: conversationNoteSubject(workspace, second),
          observedAt: "2026-11-27T03:05:30.000Z",
          expiresAt: "2026-12-27T03:05:30.000Z",
          promotedAt: "2026-11-27T03:06:00.000Z",
          source: { kind: "event", sourceId: later.eventId, contentHash: later.eventHash },
          reviewEventId: later.eventId,
          reviewEventHash: later.eventHash,
          supersedesContextEntryId: supersedes,
        },
        "7",
      );
    const kept = project([
      recorded(),
      delivered(),
      note(3),
      secondRecorded,
      secondDelivered,
      replacing(`actx_${"5".repeat(24)}`),
    ]);
    expect(kept.entries.map((entry) => entry.status)).toEqual(["superseded", "active"]);
    // The same records without the pointer stand, so only superseding reviewed memory is refused.
    const unpointed = replacing("");
    const standing = {
      ...unpointed,
      seq: 7,
      payload: { ...unpointed.payload, supersedesContextEntryId: null },
    };
    const reviewed = project([
      verified,
      outcome(4),
      { ...secondRecorded, seq: 5 },
      { ...secondDelivered, seq: 6 },
      standing,
    ]);
    expect(reviewed.entries.map((entry) => entry.memoryKind)).toEqual([
      "work_outcome",
      "conversation_note",
    ]);
    refused([
      verified,
      outcome(4),
      { ...secondRecorded, seq: 5 },
      { ...secondDelivered, seq: 6 },
      { ...replacing(`actx_${"6".repeat(24)}`), seq: 7 },
    ]);
  });

  it("lets one receipt attest one note, and never hands a note to another agent", () => {
    refused([recorded(), delivered(), note(3), note(4, {}, "6")]);
    // Superseding the first note does not let the same receipt attest a second one.
    expect(() =>
      project([
        recorded(),
        delivered(),
        note(3),
        note(4, { supersedesContextEntryId: `actx_${"5".repeat(24)}` }, "6"),
      ]),
    ).toThrow("A delivery's receipt attests one conversation note.");
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
