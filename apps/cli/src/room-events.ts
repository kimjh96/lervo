// Room records (Lervo ADE rooms, "State, events, privacy, and failure meaning"): who joined, who
// mentioned whom, which delivery reached its session, and when an exchange paused, by
// identifiers, counts, and times only, never message text. They need event schema 15. A
// repository whose writer selects less records nothing, and recording never fails the room.
import { roomEventSchemaVersion } from "@lervo/event-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  roomMentionRecordedEventId,
  type RoomExchangePausedEventPayload,
  type RoomMentionDeliveredEventPayload,
  type RoomMentionRecordedEventPayload,
  type RoomParticipantJoinedEventPayload,
} from "@lervo/schemas";

import { sha256 } from "./hosted-session-events.js";

export type RoomEvent =
  | {
      readonly type: "room.participant.joined";
      readonly payload: RoomParticipantJoinedEventPayload;
    }
  | { readonly type: "room.mention.recorded"; readonly payload: RoomMentionRecordedEventPayload }
  | { readonly type: "room.mention.delivered"; readonly payload: RoomMentionDeliveredEventPayload }
  | { readonly type: "room.exchange.paused"; readonly payload: RoomExchangePausedEventPayload };

export type RoomEventOutcome = "recorded" | "inactive" | "unavailable";

const POLICY_VERSION = sha256("lervo.room-events.v1");

/** The mention a delivery carries: one ID per delivery, which every record of it shares. */
export function mentionIdOf(deliveryId: string): string {
  return `mnt_${sha256(deliveryId).slice("sha256:".length, "sha256:".length + 24)}`;
}

/**
 * An event's ID: a mention's record has the ID its mention derives, so a note's attestation finds
 * it; every other record's ID derives from its type and payload.
 */
export function roomEventId(event: RoomEvent): string {
  return event.type === "room.mention.recorded"
    ? roomMentionRecordedEventId(event.payload.mentionId)
    : `evt_${sha256(JSON.stringify([event.type, event.payload])).slice(7, 39)}`;
}

/**
 * Appends `events`, or nothing when the writer selects a schema below 15. Each event's ID derives
 * from its type and payload, so recording the same event again changes nothing.
 */
export function appendRoomEvents(
  storage: Pick<ProjectStorage, "manifest" | "events" | "writableEventSchemaVersion">,
  events: readonly RoomEvent[],
): "recorded" | "inactive" {
  if ((storage.writableEventSchemaVersion ?? 1) < roomEventSchemaVersion) return "inactive";
  for (const event of events) {
    const digest = sha256(JSON.stringify([event.type, event.payload])).slice(7, 39);
    const eventId = roomEventId(event);
    if (storage.events.get(eventId)) continue;
    const anchor =
      "workspaceId" in event.payload ? event.payload.workspaceId : event.payload.mentionId;
    storage.events.append({
      eventId,
      projectId: storage.manifest.projectId,
      runId: `run_room_${sha256(anchor).slice(7, 31)}`,
      sessionId: `ses_room_${digest.slice(0, 24)}`,
      type: event.type,
      schemaVersion: roomEventSchemaVersion,
      occurredAt: event.payload.occurredAt,
      actor: { kind: "system" },
      policyVersion: POLICY_VERSION,
      payload: { ...event.payload },
    });
  }
  return "recorded";
}

/**
 * Records `events` in the repository at `repositoryRoot`. It never throws: a store that cannot
 * take them answers `unavailable`, and the room goes on as it would without records.
 */
export async function recordRoomEvents(
  repositoryRoot: string,
  events: readonly RoomEvent[],
): Promise<RoomEventOutcome> {
  if (events.length === 0) return "recorded";
  try {
    const storage = await openProjectStorage(repositoryRoot);
    try {
      return appendRoomEvents(storage, events);
    } finally {
      await storage.close();
    }
  } catch {
    return "unavailable";
  }
}
