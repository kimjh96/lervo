import type { DatabaseSync } from "node:sqlite";

import type { ConversationDeliveryReceipt } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { decision, inbound, integer, outbound, text } from "./codec.js";
import { InteractionSQLiteError } from "./errors.js";

export function auditConversationOutbox(database: DatabaseSync): void {
  const rows = database.prepare("SELECT * FROM conversation_outbox ORDER BY outbound_id").all();
  for (const row of rows) {
    const eventRow = database
      .prepare("SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ?")
      .get(text(row, "source_event_id"), text(row, "role_id"));
    if (eventRow === undefined) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation outbox inbox source is missing.",
      );
    }
    const message = outbound(row, inbound(eventRow));
    const decisionRow = database
      .prepare(
        "SELECT * FROM conversation_participation_decisions WHERE event_id = ? AND role_id = ?",
      )
      .get(text(row, "source_event_id"), text(row, "role_id"));
    if (
      eventRow.status !== "completed" ||
      decisionRow === undefined ||
      decision(decisionRow, inbound(eventRow)).action !== "respond"
    ) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation outbox has no completed decision.",
      );
    }
    if (row.status === "delivered") {
      let receipt;
      try {
        receipt = JSON.parse(String(row.receipt_json)) as ConversationDeliveryReceipt;
      } catch (error) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The delivery receipt JSON is invalid.",
          { cause: error },
        );
      }
      if (
        !validateSchema("conversationDeliveryReceipt", receipt).valid ||
        receipt.outboundId !== message.outboundId ||
        receipt.integrationId !== message.target.integrationId ||
        Date.parse(receipt.deliveredAt) !== integer(row, "delivered_at_ms") ||
        Date.parse(receipt.deliveredAt) < Date.parse(message.createdAt)
      ) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The delivery receipt source relation differs.",
        );
      }
    }
  }
}
