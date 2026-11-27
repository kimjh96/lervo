// A conversation note's provenance (ADR-0454; Lervo ADE rooms, "Memory from conversation"): an
// agent's own summary after a turn delivered to it in a conversation. The agent wrote the words,
// so no review can attest them; the delivery's receipt attests where they came from instead.
import { roomMentionRecordedEventId } from "@lervo/schemas";

import type { AgentContextEventEnvelope } from "./agent-context-types.js";

/** A conversation note's subject: its conversation, then a topic digest. */
const NOTE_SUBJECT = /^conversation\/([a-f0-9]{24})\/[a-z0-9]{1,64}$/u;

/** The subject key of a note on `topic` in conversation `workspaceId` (`wsp_` and 24 hex). */
export function conversationNoteSubject(workspaceId: string, topic: string): string {
  return `conversation/${workspaceId.slice("wsp_".length)}/${topic}`;
}

/** The parts of a promotion a conversation note's provenance binds. */
interface NotePayload {
  readonly agentId: string;
  readonly layer: string;
  readonly subjectKey?: string | undefined;
  readonly sensitivity?: string | undefined;
  readonly confidence?: string | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly source: {
    readonly kind: string;
    readonly sourceId: string;
    readonly contentHash: string;
  };
  readonly reviewEventId: string;
  readonly reviewEventHash: string;
  readonly promotedAt: string;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * Whether a conversation note's receipt attests it. It holds only for a self-reported work note
 * at medium confidence, internal, and expiring. The receipt is its source and its review: a
 * `room.mention.delivered` before the promotion, whose mention was recorded to this agent in the
 * conversation the subject names. Any lookup that fails refuses the note.
 */
export function conversationNoteAttested(
  payload: NotePayload,
  review: AgentContextEventEnvelope,
  eventById: (eventId: string) => AgentContextEventEnvelope | undefined,
): boolean {
  const subject = NOTE_SUBJECT.exec(payload.subjectKey ?? "");
  const delivered = record(review.payload);
  if (
    subject === null ||
    payload.layer !== "work" ||
    payload.confidence !== "medium" ||
    payload.sensitivity !== "internal" ||
    typeof payload.expiresAt !== "string" ||
    review.type !== "room.mention.delivered" ||
    payload.source.kind !== "event" ||
    payload.source.sourceId !== payload.reviewEventId ||
    payload.source.contentHash !== payload.reviewEventHash ||
    typeof delivered.mentionId !== "string" ||
    typeof delivered.occurredAt !== "string" ||
    !(Date.parse(delivered.occurredAt) <= Date.parse(payload.promotedAt))
  )
    return false;
  const mention = eventById(roomMentionRecordedEventId(delivered.mentionId));
  const recorded = record(mention?.payload);
  return (
    mention?.type === "room.mention.recorded" &&
    recorded.mentionId === delivered.mentionId &&
    recorded.toAgentId === payload.agentId &&
    recorded.workspaceId === `wsp_${subject[1]}`
  );
}
