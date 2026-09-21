import { DatabaseSync } from "node:sqlite";

import type { ConversationAgentBinding, ConversationContentReference } from "@lervo/schemas";

import type { ConversationDiscussionAssignmentEnvelope } from "./conversation-discussion-protocol.js";
import {
  claimConversationDiscussionDecision,
  dueConversationDiscussions,
  nextConversationDiscussionDeadline,
  type DueConversationDiscussion,
} from "./conversation-discussion-deadline-store.js";
import {
  conversationDiscussionSchemaVersion,
  openConversationDiscussionDatabase,
} from "./conversation-discussion-store-schema.js";

const MAXIMUM_DISCUSSIONS = 128;
const MAXIMUM_PROTOCOL_EVENTS = 1_024;

export interface StoredConversationDiscussion {
  envelope: ConversationDiscussionAssignmentEnvelope;
  topic: ConversationContentReference;
  originEventId: string;
  decisionEventId: string | null;
}

export interface StoredConversationDiscussionContribution {
  participantId: string;
  roleId: string;
  agentBinding: ConversationAgentBinding;
  eventId: string;
  content: ConversationContentReference;
  occurredAt: string;
}

export type ConversationDiscussionProtocolState =
  | "discussion.requested"
  | "discussion.participant.accepted"
  | "discussion.turn.completed"
  | "discussion.turn.rejected"
  | "discussion.converged"
  | "discussion.failed";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parse<T>(value: unknown, label: string): T {
  if (typeof value !== "string") throw new Error(`The stored ${label} is invalid.`);
  return JSON.parse(value) as T;
}

export class SQLiteConversationDiscussionStore {
  private closed = false;

  private constructor(
    readonly path: string,
    private readonly database: DatabaseSync,
  ) {}

  static async open(path: string): Promise<SQLiteConversationDiscussionStore> {
    const opened = await openConversationDiscussionDatabase(path);
    const store = new SQLiteConversationDiscussionStore(opened.path, opened.database);
    store.checkIntegrity();
    return store;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The conversation discussion store is closed.");
  }

  start(input: {
    envelope: ConversationDiscussionAssignmentEnvelope;
    topic: ConversationContentReference;
    originEventId: string;
    requestedAt: string;
    recordRequested?: boolean;
  }): void {
    this.assertOpen();
    const requestedAtMs = Date.parse(input.requestedAt);
    if (!Number.isFinite(requestedAtMs)) throw new Error("The discussion request time is invalid.");
    const envelopeJson = json(input.envelope);
    const topicJson = json(input.topic);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.database
        .prepare(
          `SELECT envelope_json, topic_json, origin_event_id, requested_at
           FROM conversation_discussions WHERE discussion_id = ?`,
        )
        .get(input.envelope.discussionId);
      if (current === undefined) {
        this.database
          .prepare(
            `INSERT INTO conversation_discussions (
               discussion_id, envelope_json, topic_json, origin_event_id,
               decision_event_id, requested_at_ms, requested_at
             ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(
            input.envelope.discussionId,
            envelopeJson,
            topicJson,
            input.originEventId,
            requestedAtMs,
            input.requestedAt,
          );
      } else if (
        current.envelope_json !== envelopeJson ||
        current.topic_json !== topicJson ||
        current.origin_event_id !== input.originEventId ||
        current.requested_at !== input.requestedAt
      ) {
        throw new Error("The discussion ID is already bound to different coordinates.");
      }
      if (input.recordRequested !== false) {
        this.recordProtocolStateInTransaction({
          discussionId: input.envelope.discussionId,
          state: "discussion.requested",
          turnId: input.envelope.turnId,
          participantId: input.envelope.source.participantId,
          reasonCode: null,
          occurredAt: input.requestedAt,
        });
      }
      this.prune();
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  get(discussionId: string): StoredConversationDiscussion | null {
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT envelope_json, topic_json, origin_event_id, decision_event_id
         FROM conversation_discussions WHERE discussion_id = ?`,
      )
      .get(discussionId);
    if (row === undefined) return null;
    return {
      envelope: parse(row.envelope_json, "discussion envelope"),
      topic: parse(row.topic_json, "discussion topic coordinate"),
      originEventId: String(row.origin_event_id),
      decisionEventId: row.decision_event_id === null ? null : String(row.decision_event_id),
    };
  }

  recordContribution(input: {
    discussionId: string;
    contribution: StoredConversationDiscussionContribution;
  }): { discussion: StoredConversationDiscussion; complete: boolean } {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const discussion = this.get(input.discussionId);
      if (discussion === null) throw new Error("The discussion contribution has no local request.");
      const expected = discussion.envelope.targets.find(
        (target) => target.participantId === input.contribution.participantId,
      );
      if (
        expected === undefined ||
        expected.roleId !== input.contribution.roleId ||
        json(expected.agentBinding) !== json(input.contribution.agentBinding)
      ) {
        throw new Error("The discussion contribution source differs from the accepted roster.");
      }
      const current = this.database
        .prepare(
          `SELECT role_id, agent_binding_json, event_id, content_json, occurred_at
           FROM conversation_discussion_contributions
           WHERE discussion_id = ? AND participant_id = ?`,
        )
        .get(input.discussionId, input.contribution.participantId);
      const bindingJson = json(input.contribution.agentBinding);
      const contentJson = json(input.contribution.content);
      if (current === undefined) {
        this.database
          .prepare(
            `INSERT INTO conversation_discussion_contributions (
               discussion_id, participant_id, role_id, agent_binding_json,
               event_id, content_json, occurred_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.discussionId,
            input.contribution.participantId,
            input.contribution.roleId,
            bindingJson,
            input.contribution.eventId,
            contentJson,
            input.contribution.occurredAt,
          );
      } else if (
        current.role_id !== input.contribution.roleId ||
        current.agent_binding_json !== bindingJson ||
        current.event_id !== input.contribution.eventId ||
        current.content_json !== contentJson ||
        current.occurred_at !== input.contribution.occurredAt
      ) {
        throw new Error("One discussion participant produced conflicting contributions.");
      }
      this.recordProtocolStateInTransaction({
        discussionId: input.discussionId,
        state: "discussion.turn.completed",
        turnId: input.contribution.eventId,
        participantId: input.contribution.participantId,
        reasonCode: null,
        occurredAt: input.contribution.occurredAt,
      });
      const count = Number(
        this.database
          .prepare(
            "SELECT COUNT(*) AS count FROM conversation_discussion_contributions WHERE discussion_id = ?",
          )
          .get(input.discussionId)?.count,
      );
      const complete = count === discussion.envelope.targets.length;
      if (complete && discussion.decisionEventId === null) {
        this.database
          .prepare(
            `UPDATE conversation_discussions SET decision_event_id = ?
             WHERE discussion_id = ? AND decision_event_id IS NULL`,
          )
          .run(input.contribution.eventId, input.discussionId);
      }
      this.database.exec("COMMIT;");
      return { discussion: this.get(input.discussionId)!, complete };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  contributions(discussionId: string): StoredConversationDiscussionContribution[] {
    this.assertOpen();
    return this.database
      .prepare(
        `SELECT participant_id, role_id, agent_binding_json, event_id, content_json, occurred_at
         FROM conversation_discussion_contributions
         WHERE discussion_id = ? ORDER BY occurred_at, participant_id`,
      )
      .all(discussionId)
      .map((row) => ({
        participantId: String(row.participant_id),
        roleId: String(row.role_id),
        agentBinding: parse(row.agent_binding_json, "discussion agent binding"),
        eventId: String(row.event_id),
        content: parse(row.content_json, "discussion contribution coordinate"),
        occurredAt: String(row.occurred_at),
      }));
  }

  due(at: string, sourceParticipantId: string): DueConversationDiscussion[] {
    this.assertOpen();
    return dueConversationDiscussions({ database: this.database, at, sourceParticipantId });
  }

  nextDeadlineAt(sourceParticipantId: string): number | null {
    this.assertOpen();
    return nextConversationDiscussionDeadline(this.database, sourceParticipantId);
  }

  claimDecision(input: { discussionId: string; eventId: string }): boolean {
    this.assertOpen();
    return claimConversationDiscussionDecision(this.database, input);
  }

  recordProtocolState(input: {
    discussionId: string;
    state: ConversationDiscussionProtocolState;
    turnId: string;
    participantId: string;
    reasonCode: string | null;
    occurredAt: string;
  }): void {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.recordProtocolStateInTransaction(input);
      this.pruneProtocolEvents();
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private recordProtocolStateInTransaction(input: {
    discussionId: string;
    state: ConversationDiscussionProtocolState;
    turnId: string;
    participantId: string;
    reasonCode: string | null;
    occurredAt: string;
  }): void {
    const occurredAtMs = Date.parse(input.occurredAt);
    if (
      !Number.isFinite(occurredAtMs) ||
      (input.reasonCode !== null && !/^[a-z][a-z0-9_]{0,63}$/u.test(input.reasonCode))
    ) {
      throw new Error("The discussion protocol state is invalid.");
    }
    this.database
      .prepare(
        `INSERT INTO conversation_discussion_protocol_events (
           discussion_id, state, turn_id, participant_id, reason_code,
           occurred_at_ms, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (discussion_id, state, turn_id, participant_id) DO NOTHING`,
      )
      .run(
        input.discussionId,
        input.state,
        input.turnId,
        input.participantId,
        input.reasonCode,
        occurredAtMs,
        input.occurredAt,
      );
  }

  private prune(): void {
    this.database
      .prepare(
        `DELETE FROM conversation_discussions WHERE discussion_id IN (
           SELECT discussion_id FROM conversation_discussions
           ORDER BY requested_at_ms DESC, discussion_id DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(MAXIMUM_DISCUSSIONS);
    this.pruneProtocolEvents();
  }

  private pruneProtocolEvents(): void {
    this.database
      .prepare(
        `DELETE FROM conversation_discussion_protocol_events WHERE rowid IN (
           SELECT rowid FROM conversation_discussion_protocol_events
           ORDER BY occurred_at_ms DESC, discussion_id DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(MAXIMUM_PROTOCOL_EVENTS);
  }

  checkIntegrity(): void {
    this.assertOpen();
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new Error("The conversation discussion database failed integrity checking.");
    }
    const version = this.database.prepare("PRAGMA user_version;").get()?.user_version;
    if (version !== conversationDiscussionSchemaVersion) {
      throw new Error("The conversation discussion schema version is invalid.");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
