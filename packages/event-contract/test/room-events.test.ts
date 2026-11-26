import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateSchema, type EventType } from "@lervo/schemas";
import { roomEventSchemaVersion } from "../src/event-schema-versions.js";
import { sanitizeEventPayload } from "../src/redaction.js";

const hash = `sha256:${"a".repeat(64)}`;
const workspaceId = `wsp_${"b".repeat(24)}`;
const mentionId = `mnt_${"c".repeat(24)}`;
const lead = `agt_${"d".repeat(24)}`;
const reviewer = `agt_${"e".repeat(24)}`;
const occurredAt = "2026-11-27T09:00:00.000Z";
/** The documented envelope key: the first 24 hex digits of the SHA-256 of the workspace ID. */
const roomKey = createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);

const payloads = {
  "room.participant.joined": {
    workspaceId,
    agentId: reviewer,
    providerSessionDigest: hash,
    mentionedBy: lead,
    occurredAt,
  },
  "room.mention.recorded": {
    workspaceId,
    mentionId,
    fromAgentId: lead,
    toAgentId: reviewer,
    depth: 1,
    occurredAt,
  },
  "room.mention.delivered": { mentionId, providerSessionDigest: hash, occurredAt },
  "room.mention.failed": { mentionId, code: "room_session_unavailable", occurredAt },
  "room.exchange.paused": {
    workspaceId,
    agentTurnCount: 12,
    limit: 12,
    openerAgentId: lead,
    occurredAt,
  },
} as const satisfies Partial<Record<EventType, Record<string, unknown>>>;
type RoomEventType = keyof typeof payloads;
const types = Object.keys(payloads) as RoomEventType[];

function envelope(type: RoomEventType, schemaVersion: number, payload: Record<string, unknown>) {
  return {
    eventId: "evt_roomevent00001",
    projectId: "prj_room_events_1",
    runId: `run_room_${roomKey}`,
    sessionId: `ses_room_${roomKey}`,
    seq: 1,
    type,
    occurredAt: "2026-11-27T09:00:01.000Z",
    actor: { kind: "system" },
    schemaVersion,
    policyVersion: hash,
    payload,
    previousHash: null,
    eventHash: hash,
  };
}

function sanitized(type: RoomEventType, payload: Record<string, unknown>) {
  return sanitizeEventPayload(type, payload).payload;
}

describe("agents mentioning each other in a conversation (schema 15, ADR-0641)", () => {
  it("are event types only from schema 15", () => {
    expect(roomEventSchemaVersion).toBe(15);
    for (const type of types)
      for (let schemaVersion = 1; schemaVersion <= 15; schemaVersion++)
        expect(validateSchema("event", envelope(type, schemaVersion, payloads[type])).valid).toBe(
          schemaVersion === 15,
        );
  });

  it("keep identifiers, counts, and times, and drop message text", () => {
    for (const type of types) {
      expect(sanitized(type, payloads[type])).toEqual(payloads[type]);
      const extra = sanitizeEventPayload(type, {
        ...payloads[type],
        text: "@Arin please review the retry",
        sessionId: "6f1c2a4e-0b8d-4c55-9b1e-2d3f4a5b6c7d",
      });
      expect(extra.payload, type).toEqual(payloads[type]);
      expect(extra.redactions.map((redaction) => redaction.path).sort()).toEqual([
        "$.sessionId",
        "$.text",
      ]);
    }
  });

  it("name the owner as `owner` or null, and a pause without a known opener as null", () => {
    const joined = payloads["room.participant.joined"];
    expect(sanitized("room.participant.joined", { ...joined, mentionedBy: "owner" })).toEqual({
      ...joined,
      mentionedBy: "owner",
    });
    const recorded = payloads["room.mention.recorded"];
    expect(sanitized("room.mention.recorded", { ...recorded, fromAgentId: null })).toEqual({
      ...recorded,
      fromAgentId: null,
    });
    const paused = payloads["room.exchange.paused"];
    expect(sanitized("room.exchange.paused", { ...paused, openerAgentId: null })).toEqual({
      ...paused,
      openerAgentId: null,
    });
    for (const bounds of [
      { agentTurnCount: 0, limit: 1 },
      { agentTurnCount: 1000, limit: 1000 },
    ])
      expect(sanitized("room.exchange.paused", { ...paused, ...bounds })).toEqual({
        ...paused,
        ...bounds,
      });
    for (const code of [
      "mention_target_inactive",
      "room_session_unavailable",
      "room_delivery_failed",
      "exchange_paused",
    ]) {
      const failed = { ...payloads["room.mention.failed"], code };
      expect(sanitized("room.mention.failed", failed)).toEqual(failed);
    }
  });

  it("refuse payloads outside their closed shapes", () => {
    const refused: [RoomEventType, Record<string, unknown>][] = [
      ["room.participant.joined", { ...payloads["room.participant.joined"], mentionedBy: null }],
      ["room.participant.joined", { ...payloads["room.participant.joined"], mentionedBy: "Arin" }],
      [
        "room.participant.joined",
        { ...payloads["room.participant.joined"], providerSessionDigest: "6f1c2a4e" },
      ],
      ["room.participant.joined", { ...payloads["room.participant.joined"], agentId: "owner" }],
      ["room.mention.recorded", { ...payloads["room.mention.recorded"], fromAgentId: "owner" }],
      ["room.mention.recorded", { ...payloads["room.mention.recorded"], toAgentId: null }],
      ["room.mention.recorded", { ...payloads["room.mention.recorded"], depth: 9 }],
      ["room.mention.recorded", { ...payloads["room.mention.recorded"], depth: -1 }],
      ["room.mention.recorded", { ...payloads["room.mention.recorded"], depth: 1.5 }],
      ["room.mention.recorded", { ...payloads["room.mention.recorded"], mentionId: "mnt_1" }],
      ["room.mention.recorded", { ...payloads["room.mention.recorded"], workspaceId: "wsp_1" }],
      ["room.mention.delivered", { mentionId, occurredAt }],
      ["room.mention.failed", { ...payloads["room.mention.failed"], code: "agent_suspended" }],
      ["room.exchange.paused", { ...payloads["room.exchange.paused"], agentTurnCount: -1 }],
      ["room.exchange.paused", { ...payloads["room.exchange.paused"], agentTurnCount: 1001 }],
      ["room.exchange.paused", { ...payloads["room.exchange.paused"], limit: 0 }],
      ["room.exchange.paused", { ...payloads["room.exchange.paused"], limit: 1001 }],
      ["room.exchange.paused", { ...payloads["room.exchange.paused"], occurredAt: "yesterday" }],
    ];
    for (const [type, payload] of refused)
      expect(() => sanitizeEventPayload(type, payload), JSON.stringify(payload)).toThrow();
  });
});
