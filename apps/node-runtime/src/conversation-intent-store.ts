import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ConversationInboundEvent } from "@lervo/schemas";

import type { ConversationIntentResolution } from "./conversation-intent-resolver.js";

function validEffect(value: unknown): value is ConversationIntentResolution["effect"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const effect = value as Record<string, unknown>;
  if (effect.kind === "none" || effect.kind === "repository_work") {
    return Object.keys(effect).length === 1;
  }
  return (
    effect.kind === "discord_current_member_nickname_set" &&
    Object.keys(effect).length === 2 &&
    typeof effect.nickname === "string" &&
    [...effect.nickname].length >= 1 &&
    [...effect.nickname].length <= 32 &&
    !effect.nickname.includes("\0")
  );
}

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
          participation TEXT NOT NULL CHECK (participation IN ('relevant', 'not_relevant')),
          effect_json TEXT,
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
      const columns = new Set(
        database
          .prepare("PRAGMA table_info(conversation_intent_resolutions)")
          .all()
          .map((column) => column.name),
      );
      if (!columns.has("effect_json")) {
        database.exec("ALTER TABLE conversation_intent_resolutions ADD COLUMN effect_json TEXT;");
      }
      if (!columns.has("participation")) {
        database.exec(
          "ALTER TABLE conversation_intent_resolutions ADD COLUMN participation TEXT CHECK (participation IN ('relevant', 'not_relevant'));",
        );
      }
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
      !validEffect(input.resolution.effect) ||
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
      input.resolution.participation,
      JSON.stringify(input.resolution.effect),
      input.resolution.resultDigest,
      input.resolvedAt,
    ] as const;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO conversation_intent_resolutions
          (event_id, message_hash, provider_id, model, adapter_version, intent, confidence,
            participation, effect_json, result_digest, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...values);
    const current = this.database
      .prepare(
        `SELECT event_id, message_hash, provider_id, model, adapter_version, intent, confidence,
          participation, effect_json, result_digest, resolved_at
          FROM conversation_intent_resolutions WHERE event_id = ?`,
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
          participation, effect_json, result_digest, resolved_at
          FROM conversation_intent_resolutions WHERE event_id = ?`,
      )
      .get(event.eventId) as Record<string, unknown> | undefined;
    if (current === undefined) return null;
    const model = current.model;
    let effect: ConversationIntentResolution["effect"];
    if (current.effect_json === null) {
      effect = current.intent === "continue_work" ? { kind: "repository_work" } : { kind: "none" };
    } else {
      try {
        effect = JSON.parse(String(current.effect_json)) as ConversationIntentResolution["effect"];
      } catch {
        throw new Error("The stored conversation intent effect is invalid.");
      }
    }
    if (
      current.event_id !== event.eventId ||
      current.message_hash !== event.content.contentHash ||
      typeof current.provider_id !== "string" ||
      !/^[a-z][a-z0-9._-]{0,63}$/u.test(current.provider_id) ||
      (model !== null &&
        (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(model))) ||
      !["1", "2"].includes(current.adapter_version as string) ||
      !["answer", "continue_work", "clarify"].includes(current.intent as string) ||
      !["high", "medium", "low"].includes(current.confidence as string) ||
      ![null, "relevant", "not_relevant"].includes(current.participation as string | null) ||
      !validEffect(effect) ||
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
      participation:
        current.participation === null
          ? "relevant"
          : (current.participation as ConversationIntentResolution["participation"]),
      effect,
      provider: {
        providerId: current.provider_id,
        model,
        adapterVersion: current.adapter_version as "1" | "2",
      },
      resultDigest: current.result_digest,
    };
  }

  close(): void {
    this.database.close();
  }
}
