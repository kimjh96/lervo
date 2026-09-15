import { DatabaseSync } from "node:sqlite";

import type { ConversationInboundEvent } from "@lervo/schemas";

const MAXIMUM_PENDING_GOALS = 1_024;

export interface PendingConversationGoal {
  eventId: string;
  projectId: string;
  ownerAgentId: string;
  contentHash: string;
  sourceEventKeyHash: string;
  conversationId: string;
  threadId: string | null;
  requesterKind: "human" | "agent";
  requesterParticipantId: string;
  requesterRoleId: string | null;
  createdAt: string;
}

/** Durable surface-neutral receipt for a goal that has not received execution authority. */
export class SQLiteConversationGoalIntakeStore {
  private constructor(private readonly database: DatabaseSync) {}

  static open(path: string): SQLiteConversationGoalIntakeStore {
    const database = new DatabaseSync(path, { allowExtension: false });
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS conversation_goal_intake (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_agent_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_event_key_hash TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        requester_kind TEXT NOT NULL CHECK (requester_kind IN ('human', 'agent')),
        requester_participant_id TEXT NOT NULL,
        requester_role_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status = 'pending_authority'),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS conversation_goal_intake_no_update
        BEFORE UPDATE ON conversation_goal_intake
        BEGIN SELECT RAISE(ABORT, 'conversation goal intake is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS conversation_goal_intake_no_delete
        BEFORE DELETE ON conversation_goal_intake
        BEGIN SELECT RAISE(ABORT, 'conversation goal intake cannot be deleted'); END;
    `);
    return new SQLiteConversationGoalIntakeStore(database);
  }

  recordPending(input: {
    event: ConversationInboundEvent;
    ownerAgentId: string;
    createdAt: string;
  }): { duplicate: boolean } {
    const { event } = input;
    if (
      !["human", "agent"].includes(event.actor.kind) ||
      !/^agt_[a-f0-9]{24}$/u.test(input.ownerAgentId) ||
      !Number.isFinite(Date.parse(input.createdAt))
    )
      throw new Error("The pending conversation goal receipt is invalid.");
    const values = [
      event.eventId,
      event.target.projectId,
      input.ownerAgentId,
      event.content.contentHash,
      event.sourceEventKeyHash,
      event.target.conversationId,
      event.target.threadId ?? "",
      event.actor.kind,
      event.actor.participantId,
      event.actor.roleId ?? "",
      "pending_authority",
      input.createdAt,
    ] as const;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare("SELECT * FROM conversation_goal_intake WHERE event_id = ?")
        .get(event.eventId) as Record<string, unknown> | undefined;
      if (existing === undefined) {
        const count = Number(
          (
            this.database
              .prepare("SELECT COUNT(*) AS count FROM conversation_goal_intake")
              .get() as {
              count: number;
            }
          ).count,
        );
        if (count >= MAXIMUM_PENDING_GOALS)
          throw new Error("The pending conversation goal receipt capacity is exhausted.");
        this.database
          .prepare(
            "INSERT INTO conversation_goal_intake VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(...values);
      } else if (JSON.stringify(Object.values(existing)) !== JSON.stringify(values)) {
        throw new Error("The pending conversation goal receipt conflicts with prior evidence.");
      }
      this.database.exec("COMMIT");
      return { duplicate: existing !== undefined };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listPending(): PendingConversationGoal[] {
    return this.database
      .prepare(
        `SELECT event_id, project_id, owner_agent_id, content_hash, source_event_key_hash,
          conversation_id, thread_id, requester_kind, requester_participant_id,
          requester_role_id, created_at FROM conversation_goal_intake ORDER BY created_at, event_id`,
      )
      .all()
      .map((row) => ({
        eventId: String(row.event_id),
        projectId: String(row.project_id),
        ownerAgentId: String(row.owner_agent_id),
        contentHash: String(row.content_hash),
        sourceEventKeyHash: String(row.source_event_key_hash),
        conversationId: String(row.conversation_id),
        threadId: row.thread_id === "" ? null : String(row.thread_id),
        requesterKind: row.requester_kind as "human" | "agent",
        requesterParticipantId: String(row.requester_participant_id),
        requesterRoleId: row.requester_role_id === "" ? null : String(row.requester_role_id),
        createdAt: String(row.created_at),
      }));
  }

  close(): void {
    this.database.close();
  }
}
