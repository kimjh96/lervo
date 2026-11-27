import type { FromSchema } from "json-schema-to-ts";
import { sha256Schema, timestampSchema, workforceAgentIdSchema } from "./common.js";

/**
 * Schema 15: agents mentioning each other in an ADE conversation (ADR-0641, ade-rooms.md). Each
 * record carries identifiers, counts, and times only; message text stays in the providers'
 * transcripts. A session appears only as `providerSessionDigest`, as in the hosted session events,
 * so its UUID never leaves the host.
 */
export const roomEventTypes = [
  "room.participant.joined",
  "room.mention.recorded",
  "room.mention.delivered",
  "room.mention.failed",
  "room.exchange.paused",
] as const;

/** Why a mention was not delivered; a failed mention is never retried silently. */
export const roomMentionFailureCodes = [
  "mention_target_inactive",
  "room_session_unavailable",
  "room_delivery_failed",
  "exchange_paused",
] as const;

/**
 * The ID of the event that records mention `mentionId`: one per mention, derived from it, so a
 * reader such as a conversation note's attestation finds it by ID without a scan.
 */
export function roomMentionRecordedEventId(mentionId: string): string {
  return `evt_mention_${mentionId.slice("mnt_".length)}`;
}

const workspaceId = { type: "string", pattern: "^wsp_[a-f0-9]{24}$" } as const;
const mentionId = { type: "string", pattern: "^mnt_[a-f0-9]{24}$" } as const;

export const roomParticipantJoinedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/room-participant-joined-event-payload.schema.json",
  type: "object",
  properties: {
    workspaceId,
    agentId: workforceAgentIdSchema,
    providerSessionDigest: sha256Schema,
    /** The agent whose mention brought the joining agent in, or the owner. */
    mentionedBy: { anyOf: [workforceAgentIdSchema, { type: "string", const: "owner" }] },
    occurredAt: timestampSchema,
  },
  required: ["workspaceId", "agentId", "providerSessionDigest", "mentionedBy", "occurredAt"],
  additionalProperties: false,
} as const;

export const roomMentionRecordedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/room-mention-recorded-event-payload.schema.json",
  type: "object",
  properties: {
    workspaceId,
    mentionId,
    /** Null when the owner mentioned. */
    fromAgentId: { anyOf: [workforceAgentIdSchema, { type: "null" }] },
    toAgentId: workforceAgentIdSchema,
    /** Deliveries since the turn that started the chain; the exchange pauses beyond 8. */
    depth: { type: "integer", minimum: 0, maximum: 8 },
    occurredAt: timestampSchema,
  },
  required: ["workspaceId", "mentionId", "fromAgentId", "toAgentId", "depth", "occurredAt"],
  additionalProperties: false,
} as const;

export const roomMentionDeliveredEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/room-mention-delivered-event-payload.schema.json",
  type: "object",
  properties: {
    mentionId,
    providerSessionDigest: sha256Schema,
    occurredAt: timestampSchema,
  },
  required: ["mentionId", "providerSessionDigest", "occurredAt"],
  additionalProperties: false,
} as const;

export const roomMentionFailedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/room-mention-failed-event-payload.schema.json",
  type: "object",
  properties: {
    mentionId,
    code: { type: "string", enum: roomMentionFailureCodes },
    occurredAt: timestampSchema,
  },
  required: ["mentionId", "code", "occurredAt"],
  additionalProperties: false,
} as const;

export const roomExchangePausedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/room-exchange-paused-event-payload.schema.json",
  type: "object",
  properties: {
    workspaceId,
    /** Bounded far above ADR-0454's budget of 12 turns in 10 minutes. */
    agentTurnCount: { type: "integer", minimum: 0, maximum: 1000 },
    limit: { type: "integer", minimum: 1, maximum: 1000 },
    /**
     * The agent whose turn the owner started, which gets one more turn to summarize; null when the
     * core saw no owner turn open the exchange, as after the resident restarted.
     */
    openerAgentId: { anyOf: [workforceAgentIdSchema, { type: "null" }] },
    occurredAt: timestampSchema,
  },
  required: ["workspaceId", "agentTurnCount", "limit", "openerAgentId", "occurredAt"],
  additionalProperties: false,
} as const;

export type RoomParticipantJoinedEventPayload = FromSchema<
  typeof roomParticipantJoinedEventPayloadSchema
>;
export type RoomMentionRecordedEventPayload = FromSchema<
  typeof roomMentionRecordedEventPayloadSchema
>;
export type RoomMentionDeliveredEventPayload = FromSchema<
  typeof roomMentionDeliveredEventPayloadSchema
>;
export type RoomMentionFailedEventPayload = FromSchema<typeof roomMentionFailedEventPayloadSchema>;
export type RoomExchangePausedEventPayload = FromSchema<
  typeof roomExchangePausedEventPayloadSchema
>;
