import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ConversationDeliveryReceipt, ConversationOutboundMessage } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { decision, inbound, integer, outbound, text } from "./codec.js";
import { interactionSQLiteSchemaVersion } from "./database.js";
import { InteractionSQLiteError } from "./errors.js";
import { iterateSqliteRows, sqliteRow, sqliteRows } from "./sqlite-row.js";

export interface ConversationOutboundDeliveryRecord {
  status: "pending" | "leased" | "delivered" | "attention_required";
  outbound: ConversationOutboundMessage;
  receipt: ConversationDeliveryReceipt | null;
}

function receipt(row: Record<string, unknown>, message: ConversationOutboundMessage) {
  if (row.status !== "delivered") return null;
  let value: unknown;
  try {
    value = JSON.parse(text(row, "receipt_json"));
  } catch (error) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The inspected conversation receipt JSON is invalid.",
      { cause: error },
    );
  }
  const candidate = value as ConversationDeliveryReceipt;
  if (
    !validateSchema("conversationDeliveryReceipt", candidate).valid ||
    candidate.outboundId !== message.outboundId ||
    candidate.integrationId !== message.target.integrationId ||
    Date.parse(candidate.deliveredAt) !== integer(row, "delivered_at_ms") ||
    Date.parse(candidate.deliveredAt) < Date.parse(message.createdAt)
  ) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The inspected conversation delivery receipt differs from its outbound.",
    );
  }
  return structuredClone(candidate);
}

function assertProtectiveSchema(database: DatabaseSync): void {
  const required = new Set([
    "conversation_inbox_identity_immutable",
    "conversation_inbox_lifecycle_guard",
    "conversation_inbox_no_delete",
    "conversation_decisions_immutable",
    "conversation_decisions_no_delete",
    "conversation_outbox_identity_immutable",
    "conversation_outbox_lifecycle_guard",
    "conversation_outbox_no_delete",
  ]);
  for (const row of iterateSqliteRows(
    database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger'").iterate(),
  )) {
    if (typeof row.name === "string") required.delete(row.name);
  }
  if (required.size > 0) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The read-only interaction source is missing protective schema.",
    );
  }
}

/** Joins a normalized source event to its validated outbounds and durable adapter receipts. */
export async function inspectConversationOutboundDeliveries(input: {
  path: string;
  sourceEventId: string;
}): Promise<ConversationOutboundDeliveryRecord[]> {
  if (!/^cve_[a-f0-9]{64}$/u.test(input.sourceEventId)) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The conversation outbound source event ID is invalid.",
    );
  }
  const path = resolve(input.path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The read-only interaction source must be an existing regular file.",
    );
  }
  const database = new DatabaseSync(path, {
    readOnly: true,
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  try {
    database.exec("PRAGMA query_only = ON;");
    if (
      sqliteRow(database.prepare("PRAGMA quick_check;").get())?.quick_check !== "ok" ||
      sqliteRow(database.prepare("PRAGMA foreign_key_check;").get()) !== undefined ||
      sqliteRow(database.prepare("PRAGMA user_version;").get())?.user_version !==
        interactionSQLiteSchemaVersion ||
      sqliteRow(
        database
          .prepare("SELECT value FROM interaction_meta WHERE key = 'storage_schema_version'")
          .get(),
      )?.value !== String(interactionSQLiteSchemaVersion)
    ) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The read-only interaction source failed integrity or version checks.",
      );
    }
    assertProtectiveSchema(database);
    return sqliteRows(
      database
        .prepare(
          "SELECT * FROM conversation_outbox WHERE source_event_id = ? ORDER BY role_id, outbound_id",
        )
        .all(input.sourceEventId),
    ).map((row) => {
      const eventRow = sqliteRow(
        database
          .prepare("SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ?")
          .get(input.sourceEventId, text(row, "role_id")),
      );
      const decisionRow = sqliteRow(
        database
          .prepare(
            "SELECT * FROM conversation_participation_decisions WHERE event_id = ? AND role_id = ?",
          )
          .get(input.sourceEventId, text(row, "role_id")),
      );
      if (eventRow === undefined || decisionRow === undefined || eventRow.status !== "completed") {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The inspected conversation outbound has no completed interaction source.",
        );
      }
      const event = inbound(eventRow);
      const message = outbound(row, event);
      if (decision(decisionRow, event).action !== "respond") {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The inspected conversation outbound has no responding decision.",
        );
      }
      const status = text(row, "status") as ConversationOutboundDeliveryRecord["status"];
      if (!new Set(["pending", "leased", "delivered", "attention_required"]).has(status)) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The inspected conversation outbound status is invalid.",
        );
      }
      return { status, outbound: message, receipt: receipt(row, message) };
    });
  } finally {
    database.close();
  }
}
