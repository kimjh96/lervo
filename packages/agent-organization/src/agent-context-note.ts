// A conversation note's provenance (ADR-0454; Lervo ADE rooms, "Memory from conversation"): an
// agent's own summary after a turn delivered to it in a conversation. The agent wrote the words,
// so no review can attest them; the delivery's receipt attests where they came from instead.
import { roomMentionRecordedEventId } from "@lervo/schemas";

import type { AgentContextEventEnvelope } from "./agent-context-types.js";

/**
 * A conversation note's subject: its conversation's hex, then its mention's hex. Both are
 * identifiers, so a subject that syncs never carries a fragment of the conversation.
 */
const NOTE_SUBJECT = /^conversation\/([a-f0-9]{24})\/([a-f0-9]{24})$/u;

/** The longest a note may last after its observation. */
export const CONVERSATION_NOTE_LIFETIME_MS = 30 * 86_400_000;

/**
 * The subject key of the note on mention `mentionId` (`mnt_` and 24 hex) in conversation
 * `workspaceId` (`wsp_` and 24 hex).
 */
export function conversationNoteSubject(workspaceId: string, mentionId: string): string {
  return `conversation/${workspaceId.slice("wsp_".length)}/${mentionId.slice("mnt_".length)}`;
}

/** The parts of a promotion a conversation note's provenance binds. */
interface NotePayload {
  readonly agentId: string;
  readonly layer: string;
  readonly subjectKey?: string | undefined;
  readonly sensitivity?: string | undefined;
  readonly confidence?: string | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly observedAt?: string | undefined;
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

/** Whether the note is self-reported work memory: medium, internal, and expiring within 30 days. */
function selfReported(payload: NotePayload): boolean {
  const observed = Date.parse(payload.observedAt ?? "");
  const expires = Date.parse(payload.expiresAt ?? "");
  return (
    payload.layer === "work" &&
    payload.confidence === "medium" &&
    payload.sensitivity === "internal" &&
    expires > observed &&
    expires <= observed + CONVERSATION_NOTE_LIFETIME_MS
  );
}

/**
 * Whether a conversation note's receipt attests it (ADR-0648). It holds only for self-reported
 * work memory. The receipt is its source and its review: a `room.mention.delivered` recorded
 * after its mention and before the promotion, and observed no later than the note. The mention
 * was recorded from another agent to this one, in the conversation and for the mention the
 * subject names. Any lookup that fails refuses the note.
 */
export function conversationNoteAttested(
  payload: NotePayload,
  promotion: AgentContextEventEnvelope,
  review: AgentContextEventEnvelope,
  eventById: (eventId: string) => AgentContextEventEnvelope | undefined,
): boolean {
  const subject = NOTE_SUBJECT.exec(payload.subjectKey ?? "");
  const delivered = record(review.payload);
  if (
    subject === null ||
    !selfReported(payload) ||
    review.type !== "room.mention.delivered" ||
    !(review.seq < promotion.seq) ||
    payload.source.kind !== "event" ||
    payload.source.sourceId !== payload.reviewEventId ||
    payload.source.contentHash !== payload.reviewEventHash ||
    delivered.mentionId !== `mnt_${subject[2]}` ||
    typeof delivered.occurredAt !== "string" ||
    !(Date.parse(delivered.occurredAt) <= Date.parse(payload.observedAt ?? "")) ||
    !(Date.parse(delivered.occurredAt) <= Date.parse(payload.promotedAt))
  )
    return false;
  const mention = eventById(roomMentionRecordedEventId(delivered.mentionId));
  const recorded = record(mention?.payload);
  return (
    mention?.type === "room.mention.recorded" &&
    mention.seq < review.seq &&
    recorded.mentionId === delivered.mentionId &&
    recorded.toAgentId === payload.agentId &&
    typeof recorded.fromAgentId === "string" &&
    recorded.fromAgentId !== recorded.toAgentId &&
    recorded.workspaceId === `wsp_${subject[1]}`
  );
}
