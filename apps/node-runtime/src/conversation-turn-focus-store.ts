import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { sqliteRow } from "./sqlite-row.js";

const SCHEMA_VERSION = 1;
const MAXIMUM_FOCUS_RECORDS = 1_024;
const ID = /^[a-z][A-Za-z0-9_-]{7,127}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface ConversationTurnFocusScope {
  projectId: string;
  conversationId: string;
  threadId: string | null;
}

export interface ConversationTurnFocus extends ConversationTurnFocusScope {
  participantId: string;
  lastEventAt: string;
  lastSourceEventKeyHash: string;
}

export interface ConversationTurnFocusStore {
  read(scope: ConversationTurnFocusScope): ConversationTurnFocus | null;
  write(focus: ConversationTurnFocus): void;
  remove(focus: ConversationTurnFocus): void;
}

function validScope(scope: ConversationTurnFocusScope): boolean {
  return (
    ID.test(scope.projectId) &&
    ID.test(scope.conversationId) &&
    (scope.threadId === null || ID.test(scope.threadId))
  );
}

function validFocus(focus: ConversationTurnFocus): boolean {
  return (
    validScope(focus) &&
    ID.test(focus.participantId) &&
    Number.isFinite(Date.parse(focus.lastEventAt)) &&
    HASH.test(focus.lastSourceEventKeyHash)
  );
}

function threadKey(threadId: string | null): string {
  return threadId ?? "";
}

export class SQLiteConversationTurnFocusStore implements ConversationTurnFocusStore {
  private closed = false;

  private constructor(
    readonly path: string,
    private readonly database: DatabaseSync,
  ) {}

  static async open(path: string): Promise<SQLiteConversationTurnFocusStore> {
    const absolute = resolve(path);
    await mkdir(dirname(absolute), { recursive: true });
    try {
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error("The conversation turn-focus path must be a regular file.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const database = new DatabaseSync(absolute, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      const defensive = database as DatabaseSync & { enableDefensive?: (active: boolean) => void };
      defensive.enableDefensive?.(true);
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
        BEGIN IMMEDIATE;
      `);
      try {
        const version = sqliteRow(database.prepare("PRAGMA user_version;").get())?.user_version;
        if (version !== 0 && version !== SCHEMA_VERSION) {
          throw new Error("The conversation turn-focus schema is unsupported.");
        }
        if (version === 0) {
          database.exec(`
            CREATE TABLE conversation_turn_focus (
              project_id TEXT NOT NULL,
              conversation_id TEXT NOT NULL,
              thread_id TEXT NOT NULL,
              participant_id TEXT NOT NULL,
              last_event_at_ms INTEGER NOT NULL CHECK (last_event_at_ms >= 0),
              last_event_at TEXT NOT NULL,
              last_source_event_key_hash TEXT NOT NULL,
              PRIMARY KEY (project_id, conversation_id, thread_id)
            ) STRICT;
            CREATE INDEX conversation_turn_focus_recency
              ON conversation_turn_focus (
                last_event_at_ms DESC,
                last_source_event_key_hash DESC,
                project_id,
                conversation_id,
                thread_id
              );
            PRAGMA user_version = 1;
          `);
        }
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      const store = new SQLiteConversationTurnFocusStore(absolute, database);
      store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The conversation turn-focus store is closed.");
  }

  read(scope: ConversationTurnFocusScope): ConversationTurnFocus | null {
    this.assertOpen();
    if (!validScope(scope)) throw new Error("The conversation turn-focus scope is invalid.");
    const row = sqliteRow(
      this.database
        .prepare(
          `SELECT participant_id, last_event_at, last_source_event_key_hash
         FROM conversation_turn_focus
         WHERE project_id = ? AND conversation_id = ? AND thread_id = ?`,
        )
        .get(scope.projectId, scope.conversationId, threadKey(scope.threadId)),
    );
    if (row === undefined) return null;
    if (
      typeof row.participant_id !== "string" ||
      typeof row.last_event_at !== "string" ||
      typeof row.last_source_event_key_hash !== "string"
    ) {
      throw new Error("The stored conversation turn focus has invalid field types.");
    }
    const focus: ConversationTurnFocus = {
      ...scope,
      participantId: row.participant_id,
      lastEventAt: row.last_event_at,
      lastSourceEventKeyHash: row.last_source_event_key_hash,
    };
    if (!validFocus(focus)) throw new Error("The stored conversation turn focus is invalid.");
    return focus;
  }

  write(focus: ConversationTurnFocus): void {
    this.assertOpen();
    if (!validFocus(focus)) throw new Error("The conversation turn focus is invalid.");
    const occurredAtMs = Date.parse(focus.lastEventAt);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = sqliteRow(
        this.database
          .prepare(
            `SELECT participant_id, last_event_at_ms, last_source_event_key_hash
           FROM conversation_turn_focus
           WHERE project_id = ? AND conversation_id = ? AND thread_id = ?`,
          )
          .get(focus.projectId, focus.conversationId, threadKey(focus.threadId)),
      );
      if (
        current?.last_event_at_ms === occurredAtMs &&
        current.last_source_event_key_hash === focus.lastSourceEventKeyHash &&
        current.participant_id !== focus.participantId
      ) {
        throw new Error("One conversation event resolved to conflicting focused participants.");
      }
      this.database
        .prepare(
          `INSERT INTO conversation_turn_focus (
             project_id, conversation_id, thread_id, participant_id,
             last_event_at_ms, last_event_at, last_source_event_key_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, conversation_id, thread_id) DO UPDATE SET
             participant_id = excluded.participant_id,
             last_event_at_ms = excluded.last_event_at_ms,
             last_event_at = excluded.last_event_at,
             last_source_event_key_hash = excluded.last_source_event_key_hash
           WHERE excluded.last_event_at_ms > conversation_turn_focus.last_event_at_ms
             OR (
               excluded.last_event_at_ms = conversation_turn_focus.last_event_at_ms
               AND excluded.last_source_event_key_hash >
                 conversation_turn_focus.last_source_event_key_hash
             )`,
        )
        .run(
          focus.projectId,
          focus.conversationId,
          threadKey(focus.threadId),
          focus.participantId,
          occurredAtMs,
          focus.lastEventAt,
          focus.lastSourceEventKeyHash,
        );
      this.database
        .prepare(
          `DELETE FROM conversation_turn_focus WHERE rowid IN (
             SELECT rowid FROM conversation_turn_focus
             ORDER BY last_event_at_ms DESC, last_source_event_key_hash DESC,
               project_id, conversation_id, thread_id
             LIMIT -1 OFFSET ?
           )`,
        )
        .run(MAXIMUM_FOCUS_RECORDS);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  remove(focus: ConversationTurnFocus): void {
    this.assertOpen();
    if (!validFocus(focus)) throw new Error("The conversation turn focus is invalid.");
    this.database
      .prepare(
        `DELETE FROM conversation_turn_focus
         WHERE project_id = ? AND conversation_id = ? AND thread_id = ?
           AND participant_id = ? AND last_event_at = ? AND last_source_event_key_hash = ?`,
      )
      .run(
        focus.projectId,
        focus.conversationId,
        threadKey(focus.threadId),
        focus.participantId,
        focus.lastEventAt,
        focus.lastSourceEventKeyHash,
      );
  }

  checkIntegrity(): void {
    this.assertOpen();
    if (sqliteRow(this.database.prepare("PRAGMA quick_check;").get())?.quick_check !== "ok") {
      throw new Error("The conversation turn-focus database failed integrity checking.");
    }
    const version = sqliteRow(this.database.prepare("PRAGMA user_version;").get())?.user_version;
    if (version !== SCHEMA_VERSION) {
      throw new Error("The conversation turn-focus schema version is invalid.");
    }
    const count = sqliteRow(
      this.database.prepare("SELECT COUNT(*) AS count FROM conversation_turn_focus").get(),
    )?.count;
    if (typeof count !== "number" || count > MAXIMUM_FOCUS_RECORDS) {
      throw new Error("The conversation turn-focus record bound is invalid.");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
