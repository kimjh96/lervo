import type { DatabaseSync } from "node:sqlite";

import type { ConversationContentReference } from "@lervo/schemas";

import type { ConversationDiscussionAssignmentEnvelope } from "./conversation-discussion-protocol.js";
import type { StoredConversationDiscussion } from "./conversation-discussion-store.js";

export interface DueConversationDiscussion {
  discussion: StoredConversationDiscussion;
  deadlineAt: string;
}

function parse<T>(value: unknown, label: string): T {
  if (typeof value !== "string") throw new Error(`The stored ${label} is invalid.`);
  return JSON.parse(value) as T;
}

export function dueConversationDiscussions(input: {
  database: DatabaseSync;
  at: string;
  sourceParticipantId: string;
}): DueConversationDiscussion[] {
  const atMs = Date.parse(input.at);
  if (!Number.isFinite(atMs)) throw new Error("The discussion deadline query time is invalid.");
  return input.database
    .prepare(
      `SELECT envelope_json, topic_json, origin_event_id, decision_event_id
       FROM conversation_discussions
       WHERE decision_event_id IS NULL
       ORDER BY requested_at_ms, discussion_id`,
    )
    .all()
    .flatMap((row) => {
      const envelope = parse<ConversationDiscussionAssignmentEnvelope>(
        row.envelope_json,
        "discussion envelope",
      );
      return envelope.source.participantId === input.sourceParticipantId &&
        Date.parse(envelope.deadlineAt) <= atMs
        ? [
            {
              discussion: {
                envelope,
                topic: parse<ConversationContentReference>(
                  row.topic_json,
                  "discussion topic coordinate",
                ),
                originEventId: String(row.origin_event_id),
                decisionEventId:
                  row.decision_event_id === null ? null : String(row.decision_event_id),
              },
              deadlineAt: envelope.deadlineAt,
            },
          ]
        : [];
    });
}

export function nextConversationDiscussionDeadline(
  database: DatabaseSync,
  sourceParticipantId: string,
): number | null {
  let earliest = Number.POSITIVE_INFINITY;
  for (const row of database
    .prepare(`SELECT envelope_json FROM conversation_discussions WHERE decision_event_id IS NULL`)
    .all()) {
    const envelope = parse<ConversationDiscussionAssignmentEnvelope>(
      row.envelope_json,
      "discussion envelope",
    );
    const deadline =
      envelope.source.participantId === sourceParticipantId
        ? Date.parse(envelope.deadlineAt)
        : Number.NaN;
    if (Number.isFinite(deadline)) earliest = Math.min(earliest, deadline);
  }
  return Number.isFinite(earliest) ? earliest : null;
}

export function claimConversationDiscussionDecision(
  database: DatabaseSync,
  input: { discussionId: string; eventId: string },
): boolean {
  const current = database
    .prepare(`SELECT decision_event_id FROM conversation_discussions WHERE discussion_id = ?`)
    .get(input.discussionId);
  if (current === undefined) return false;
  if (current.decision_event_id !== null) return current.decision_event_id === input.eventId;
  database
    .prepare(
      `UPDATE conversation_discussions SET decision_event_id = ?
       WHERE discussion_id = ? AND decision_event_id IS NULL`,
    )
    .run(input.eventId, input.discussionId);
  return true;
}
