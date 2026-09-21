import type { DatabaseSync } from "node:sqlite";

import { interactionSQLiteSchemaVersion } from "./database.js";
import type { ConversationDecisionSQLiteRepository } from "./decision-repository.js";
import { InteractionSQLiteError } from "./errors.js";
import type { ConversationInboxSQLiteRepository } from "./inbox-repository.js";
import type { ConversationOutboxSQLiteRepository } from "./outbox-repository.js";

export interface InteractionSQLiteIntegrityReport {
  valid: true;
  inboxCount: number;
  decisionCount: number;
  outboxCount: number;
}

export class ConversationInteractionSQLiteIntegrity {
  constructor(
    private readonly database: DatabaseSync,
    private readonly inbox: ConversationInboxSQLiteRepository,
    private readonly decisions: ConversationDecisionSQLiteRepository,
    private readonly outbox: ConversationOutboxSQLiteRepository,
  ) {}

  check(): InteractionSQLiteIntegrityReport {
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The Interaction SQLite quick_check failed.",
      );
    }
    const version = this.database
      .prepare("SELECT value FROM interaction_meta WHERE key = 'storage_schema_version'")
      .get()?.value;
    if (version !== String(interactionSQLiteSchemaVersion)) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The Interaction SQLite metadata is invalid.",
      );
    }
    const requiredTriggers = new Set([
      "conversation_inbox_identity_immutable",
      "conversation_inbox_lifecycle_guard",
      "conversation_inbox_no_delete",
      "conversation_decisions_immutable",
      "conversation_decisions_no_delete",
      "conversation_outbox_identity_immutable",
      "conversation_outbox_lifecycle_guard",
      "conversation_outbox_no_delete",
    ]);
    for (const row of this.database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger'")
      .all()) {
      if (typeof row.name === "string") requiredTriggers.delete(row.name);
    }
    if (requiredTriggers.size !== 0) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "An Interaction append-only trigger is missing.",
      );
    }
    return this.counts();
  }

  audit(): InteractionSQLiteIntegrityReport {
    this.check();
    if (this.database.prepare("PRAGMA foreign_key_check;").all().length !== 0) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "An Interaction foreign key is corrupted.",
      );
    }
    const inbox = this.inbox.auditAll();
    this.decisions.auditAll();
    this.outbox.auditAll();
    for (const coordinate of inbox) {
      const decision = this.decisions.read(coordinate.event, coordinate.roleId);
      const outbound = this.outbox.readForSource(coordinate.event, coordinate.roleId);
      if (
        (coordinate.status === "completed") !== (decision !== null) ||
        (decision?.action === "respond") !== (outbound !== null)
      ) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The Interaction completion source relation differs.",
        );
      }
    }
    return this.counts();
  }

  private counts(): InteractionSQLiteIntegrityReport {
    const count = (table: string): number => {
      const value = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The Interaction row count is invalid.",
        );
      }
      return value;
    };
    return {
      valid: true,
      inboxCount: count("conversation_inbox"),
      decisionCount: count("conversation_participation_decisions"),
      outboxCount: count("conversation_outbox"),
    };
  }
}
