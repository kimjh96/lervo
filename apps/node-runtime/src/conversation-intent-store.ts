import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ConversationInboundEvent } from "@lervo/schemas";

import type { ConversationIntentResolution } from "./conversation-intent-resolver.js";

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;

function validCurrentProvider(
  provider: Extract<ConversationIntentResolution["provider"], { adapterVersion: "4" }>,
): boolean {
  const models = provider.observedModelIds;
  return (
    Array.isArray(models) &&
    (provider.requestedModel === null || MODEL_PATTERN.test(provider.requestedModel)) &&
    (provider.model === null || MODEL_PATTERN.test(provider.model)) &&
    models.length <= 32 &&
    new Set(models).size === models.length &&
    models.every((model) => MODEL_PATTERN.test(model)) &&
    (provider.model === null || models.includes(provider.model)) &&
    ["thread_start", "response_object", "assistant_message", "unavailable"].includes(
      provider.answerModelEvidence,
    ) &&
    (provider.model === null
      ? provider.answerModelEvidence === "unavailable" &&
        typeof provider.modelUnavailableReason === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/u.test(provider.modelUnavailableReason)
      : provider.answerModelEvidence !== "unavailable" && provider.modelUnavailableReason === null)
  );
}

function validEffect(value: unknown): value is ConversationIntentResolution["effect"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const effect = value as Record<string, unknown>;
  if (effect.kind === "none" || effect.kind === "repository_work") {
    return Object.keys(effect).length === 1;
  }
  if (effect.kind === "discord_current_member_nickname_set") {
    return (
      Object.keys(effect).length === 2 &&
      typeof effect.nickname === "string" &&
      [...effect.nickname].length >= 1 &&
      [...effect.nickname].length <= 32 &&
      !effect.nickname.includes("\0")
    );
  }
  if (effect.kind === "discord_guild_text_channel_create") {
    return (
      Object.keys(effect).length === 2 &&
      typeof effect.name === "string" &&
      /^[a-z0-9][a-z0-9_-]{0,99}$/u.test(effect.name)
    );
  }
  if (effect.kind === "workforce_agent_hire") {
    return (
      Object.keys(effect).length === 2 &&
      typeof effect.specification === "string" &&
      [...effect.specification].length >= 1 &&
      [...effect.specification].length <= 512 &&
      !effect.specification.includes("\0")
    );
  }
  return (
    effect.kind === "discord_public_thread_create" &&
    Object.keys(effect).length === 2 &&
    typeof effect.name === "string" &&
    [...effect.name].length >= 1 &&
    [...effect.name].length <= 100 &&
    !effect.name.includes("\0")
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
          requested_model TEXT,
          observed_model_ids_json TEXT,
          answer_model_evidence TEXT,
          model_unavailable_reason TEXT,
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
      if (!columns.has("requested_model")) {
        database.exec(
          "ALTER TABLE conversation_intent_resolutions ADD COLUMN requested_model TEXT;",
        );
      }
      if (!columns.has("observed_model_ids_json")) {
        database.exec(
          "ALTER TABLE conversation_intent_resolutions ADD COLUMN observed_model_ids_json TEXT;",
        );
      }
      if (!columns.has("answer_model_evidence")) {
        database.exec(
          "ALTER TABLE conversation_intent_resolutions ADD COLUMN answer_model_evidence TEXT;",
        );
      }
      if (!columns.has("model_unavailable_reason")) {
        database.exec(
          "ALTER TABLE conversation_intent_resolutions ADD COLUMN model_unavailable_reason TEXT;",
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
        !MODEL_PATTERN.test(input.resolution.provider.model)) ||
      (input.resolution.provider.adapterVersion === "4" &&
        !validCurrentProvider(input.resolution.provider)) ||
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
      input.resolution.provider.adapterVersion === "4"
        ? input.resolution.provider.requestedModel
        : null,
      input.resolution.provider.adapterVersion === "4"
        ? JSON.stringify(input.resolution.provider.observedModelIds)
        : null,
      input.resolution.provider.adapterVersion === "4"
        ? input.resolution.provider.answerModelEvidence
        : null,
      input.resolution.provider.adapterVersion === "4"
        ? input.resolution.provider.modelUnavailableReason
        : null,
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
          (event_id, message_hash, provider_id, model, requested_model, observed_model_ids_json,
            answer_model_evidence, model_unavailable_reason, adapter_version, intent, confidence,
            participation, effect_json, result_digest, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...values);
    const current = this.database
      .prepare(
        `SELECT event_id, message_hash, provider_id, model, requested_model,
          observed_model_ids_json, answer_model_evidence, model_unavailable_reason,
          adapter_version, intent, confidence,
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
        `SELECT event_id, message_hash, provider_id, model, requested_model,
          observed_model_ids_json, answer_model_evidence, model_unavailable_reason,
          adapter_version, intent, confidence,
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
      (model !== null && (typeof model !== "string" || !MODEL_PATTERN.test(model))) ||
      !["1", "2", "3", "4"].includes(current.adapter_version as string) ||
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
    const adapterVersion = current.adapter_version as "1" | "2" | "3" | "4";
    let provider: ConversationIntentResolution["provider"];
    if (adapterVersion === "4") {
      let observedModelIds: unknown;
      try {
        observedModelIds = JSON.parse(String(current.observed_model_ids_json));
      } catch {
        throw new Error("The stored conversation model identity is invalid.");
      }
      if (
        (current.requested_model !== null && typeof current.requested_model !== "string") ||
        !Array.isArray(observedModelIds) ||
        observedModelIds.some((value) => typeof value !== "string") ||
        !["thread_start", "response_object", "assistant_message", "unavailable"].includes(
          current.answer_model_evidence as string,
        ) ||
        (current.model_unavailable_reason !== null &&
          typeof current.model_unavailable_reason !== "string") ||
        (model !== null && !observedModelIds.includes(model))
      ) {
        throw new Error("The stored conversation model identity is invalid.");
      }
      provider = {
        providerId: current.provider_id as string,
        requestedModel: current.requested_model as string | null,
        model: model as string | null,
        observedModelIds: observedModelIds as string[],
        answerModelEvidence: current.answer_model_evidence as
          "thread_start" | "response_object" | "assistant_message" | "unavailable",
        modelUnavailableReason: current.model_unavailable_reason as string | null,
        adapterVersion,
      };
      if (!validCurrentProvider(provider)) {
        throw new Error("The stored conversation model identity is invalid.");
      }
    } else {
      provider = {
        providerId: current.provider_id as string,
        model: model as string | null,
        adapterVersion,
      };
    }
    return {
      intent: current.intent as ConversationIntentResolution["intent"],
      confidence: current.confidence as ConversationIntentResolution["confidence"],
      participation:
        current.participation === null
          ? "relevant"
          : (current.participation as ConversationIntentResolution["participation"]),
      effect,
      provider,
      resultDigest: current.result_digest,
    };
  }

  close(): void {
    this.database.close();
  }
}
