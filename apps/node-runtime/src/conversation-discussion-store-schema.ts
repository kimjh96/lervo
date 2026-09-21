import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const conversationDiscussionSchemaVersion = 1;

async function securePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("The conversation discussion database path is unsafe.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export async function openConversationDiscussionDatabase(
  path: string,
): Promise<{ path: string; database: DatabaseSync }> {
  const absolute = await securePath(path);
  const database = new DatabaseSync(absolute, {
    enableForeignKeyConstraints: true,
    allowExtension: false,
  });
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      BEGIN IMMEDIATE;
    `);
    try {
      const version = database.prepare("PRAGMA user_version;").get()?.user_version;
      if (version !== 0 && version !== conversationDiscussionSchemaVersion) {
        throw new Error("The conversation discussion schema is unsupported.");
      }
      if (version === 0) {
        database.exec(`
          CREATE TABLE conversation_discussions (
            discussion_id TEXT PRIMARY KEY,
            envelope_json TEXT NOT NULL,
            topic_json TEXT NOT NULL,
            origin_event_id TEXT NOT NULL UNIQUE,
            decision_event_id TEXT UNIQUE,
            requested_at_ms INTEGER NOT NULL CHECK (requested_at_ms >= 0),
            requested_at TEXT NOT NULL
          ) STRICT;
          CREATE TABLE conversation_discussion_contributions (
            discussion_id TEXT NOT NULL REFERENCES conversation_discussions(discussion_id) ON DELETE CASCADE,
            participant_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            agent_binding_json TEXT NOT NULL,
            event_id TEXT NOT NULL UNIQUE,
            content_json TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            PRIMARY KEY (discussion_id, participant_id)
          ) STRICT;
          CREATE TABLE conversation_discussion_protocol_events (
            discussion_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN (
              'discussion.requested',
              'discussion.participant.accepted',
              'discussion.turn.completed',
              'discussion.turn.rejected',
              'discussion.converged',
              'discussion.failed'
            )),
            turn_id TEXT NOT NULL,
            participant_id TEXT NOT NULL,
            reason_code TEXT,
            occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
            occurred_at TEXT NOT NULL,
            PRIMARY KEY (discussion_id, state, turn_id, participant_id)
          ) STRICT;
          CREATE INDEX conversation_discussion_protocol_events_recency
            ON conversation_discussion_protocol_events (occurred_at_ms DESC, discussion_id);
          PRAGMA user_version = 1;
        `);
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    await chmod(absolute, 0o600);
    return { path: absolute, database };
  } catch (error) {
    database.close();
    throw error;
  }
}
