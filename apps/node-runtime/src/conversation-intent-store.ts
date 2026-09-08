import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ConversationInboundEvent } from "@lervo/schemas";

import type { ConversationIntentResolution } from "./conversation-intent-resolver.js";

export interface ConversationIntentResolutionStore {
  read(event: ConversationInboundEvent): Promise<ConversationIntentResolution | null>;
  record(input: {
    event: ConversationInboundEvent;
    resolution: ConversationIntentResolution;
    resolvedAt: string;
  }): Promise<void>;
}

async function securePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe database path");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export class SQLiteConversationIntentResolutionStore implements ConversationIntentResolutionStore {
  private constructor(private readonly database: DatabaseSync) {}

  static async open(path: string): Promise<SQLiteConversationIntentResolutionStore> {
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
        CREATE TABLE IF NOT EXISTS conversation_intent_resolutions (
          event_id TEXT PRIMARY KEY,
          message_hash TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model TEXT,
          adapter_version TEXT NOT NULL,
          intent TEXT NOT NULL CHECK (intent IN ('answer', 'continue_work', 'clarify')),
          confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
          result_digest TEXT NOT NULL,
          resolved_at TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS conversation_intent_resolutions_immutable
          BEFORE UPDATE ON conversation_intent_resolutions
          BEGIN SELECT RAISE(ABORT, 'conversation intent resolution is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS conversation_intent_resolutions_no_delete
          BEFORE DELETE ON conversation_intent_resolutions
          BEGIN SELECT RAISE(ABORT, 'conversation intent resolution cannot be deleted'); END;
      `);
      await chmod(absolute, 0o600);
      return new SQLiteConversationIntentResolutionStore(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async record(input: {
    event: ConversationInboundEvent;
    resolution: ConversationIntentResolution;
    resolvedAt: string;
  }): Promise<void> {
    if (
      !Number.isFinite(Date.parse(input.resolvedAt)) ||
      !/^[a-z][a-z0-9._-]{0,63}$/u.test(input.resolution.provider.providerId) ||
      (input.resolution.provider.model !== null &&
        !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(input.resolution.provider.model)) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.resolution.resultDigest)
    ) {
      throw new Error("The conversation intent resolution evidence is invalid.");
    }
    const values = [
      input.event.eventId,
      input.event.content.contentHash,
      input.resolution.provider.providerId,
      input.resolution.provider.model,
      input.resolution.provider.adapterVersion,
      input.resolution.intent,
      input.resolution.confidence,
      input.resolution.resultDigest,
      input.resolvedAt,
    ] as const;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO conversation_intent_resolutions
          (event_id, message_hash, provider_id, model, adapter_version, intent, confidence,
            result_digest, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...values);
    const current = this.database
      .prepare(
        `SELECT event_id, message_hash, provider_id, model, adapter_version, intent, confidence,
          result_digest, resolved_at FROM conversation_intent_resolutions WHERE event_id = ?`,
      )
      .get(input.event.eventId) as Record<string, unknown> | undefined;
    if (
      current === undefined ||
      JSON.stringify(Object.values(current)) !== JSON.stringify(values)
    ) {
      throw new Error("The conversation intent resolution conflicts with its recorded evidence.");
    }
  }

  async read(event: ConversationInboundEvent): Promise<ConversationIntentResolution | null> {
    const current = this.database
      .prepare(
        `SELECT event_id, message_hash, provider_id, model, adapter_version, intent, confidence,
          result_digest, resolved_at FROM conversation_intent_resolutions WHERE event_id = ?`,
      )
      .get(event.eventId) as Record<string, unknown> | undefined;
    if (current === undefined) return null;
    const model = current.model;
    if (
      current.event_id !== event.eventId ||
      current.message_hash !== event.content.contentHash ||
      typeof current.provider_id !== "string" ||
      !/^[a-z][a-z0-9._-]{0,63}$/u.test(current.provider_id) ||
      (model !== null &&
        (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(model))) ||
      current.adapter_version !== "1" ||
      !["answer", "continue_work", "clarify"].includes(current.intent as string) ||
      !["high", "medium", "low"].includes(current.confidence as string) ||
      typeof current.result_digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(current.result_digest) ||
      typeof current.resolved_at !== "string" ||
      !Number.isFinite(Date.parse(current.resolved_at))
    ) {
      throw new Error("The stored conversation intent resolution is invalid.");
    }
    return {
      intent: current.intent as ConversationIntentResolution["intent"],
      confidence: current.confidence as ConversationIntentResolution["confidence"],
      provider: {
        providerId: current.provider_id,
        model,
        adapterVersion: "1",
      },
      resultDigest: current.result_digest,
    };
  }

  close(): void {
    this.database.close();
  }
}
