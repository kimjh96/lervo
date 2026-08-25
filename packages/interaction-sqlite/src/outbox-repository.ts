import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import { assertConversationOutboundMessage } from "@lervo/conversation-contract";
import type { ConversationOutboundLease } from "@lervo/interaction";
import {
  type ConversationDeliveryReceipt,
  type ConversationInboundEvent,
  type ConversationOutboundMessage,
  validateSchema,
} from "@lervo/schemas";

import { decision, inbound, integer, outbound, text } from "./codec.js";
import { InteractionSQLiteError } from "./errors.js";

function milliseconds(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new InteractionSQLiteError("integrity_failed", `${label} time is invalid.`);
  }
  return result;
}

function failureCode(value: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new InteractionSQLiteError("integrity_failed", "The outbox failure code is invalid.");
  }
}

export class ConversationOutboxSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  readForSource(
    event: ConversationInboundEvent,
    roleId: string,
  ): ConversationOutboundMessage | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM conversation_outbox WHERE source_event_id = ? AND role_id = ?
    `,
      )
      .get(event.eventId, roleId);
    return row === undefined ? null : outbound(row, event);
  }

  enqueue(input: {
    event: ConversationInboundEvent;
    policyId: string;
    roleId: string;
    message: ConversationOutboundMessage;
  }): void {
    assertConversationOutboundMessage({ outbound: input.message, event: input.event });
    if (input.message.policyId !== input.policyId || input.message.actor.roleId !== input.roleId)
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation outbound coordinates differ.",
      );
    this.database
      .prepare(
        `
      INSERT INTO conversation_outbox (
        outbound_id, source_event_id, policy_id, role_id, integration_id, project_id,
        conversation_id, outbound_json, status, available_at_ms,
        attempt_count, lease_id, lease_owner, lease_expires_at_ms,
        last_failure_code, last_failed_at_ms, receipt_json, delivered_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    `,
      )
      .run(
        input.message.outboundId,
        input.event.eventId,
        input.policyId,
        input.roleId,
        input.message.target.integrationId,
        input.message.target.projectId,
        input.message.target.conversationId,
        canonicalJson(input.message),
        milliseconds(input.message.createdAt, "Conversation outbound"),
      );
  }

  claim(input: {
    integrationId: string;
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): ConversationOutboundLease[] {
    if (
      !/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(input.integrationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.workerId) ||
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 1_000 ||
      input.leaseDurationMs > 300_000 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 16
    )
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation outbox lease configuration is invalid.",
      );
    const claimedAtMs = milliseconds(input.claimedAt, "Conversation outbox claim");
    const rows = this.database
      .prepare(
        `
      SELECT * FROM conversation_outbox
      WHERE integration_id = ? AND (
        (status = 'pending' AND available_at_ms <= ?)
        OR (status = 'leased' AND lease_expires_at_ms <= ?)
      )
      ORDER BY available_at_ms ASC, outbound_id ASC LIMIT ?
    `,
      )
      .all(input.integrationId, claimedAtMs, claimedAtMs, input.limit);
    return rows.map((row) => {
      const eventRow = this.database
        .prepare("SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ?")
        .get(text(row, "source_event_id"), text(row, "role_id"));
      if (eventRow === undefined) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The conversation outbox inbox source is missing.",
        );
      }
      const message = outbound(row, inbound(eventRow));
      const decisionRow = this.database
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
      const leaseId = `col_${randomBytes(24).toString("base64url")}`;
      const result = this.database
        .prepare(
          `
        UPDATE conversation_outbox SET status = 'leased',
          attempt_count = attempt_count + 1, lease_id = ?, lease_owner = ?,
          lease_expires_at_ms = ?
        WHERE outbound_id = ? AND status != 'delivered'
      `,
        )
        .run(leaseId, input.workerId, claimedAtMs + input.leaseDurationMs, message.outboundId);
      if (result.changes !== 1) {
        throw new InteractionSQLiteError(
          "lease_mismatch",
          "Could not acquire the conversation outbox lease.",
        );
      }
      const attemptCount = this.database
        .prepare("SELECT attempt_count FROM conversation_outbox WHERE outbound_id = ?")
        .get(message.outboundId)?.attempt_count;
      if (typeof attemptCount !== "number" || !Number.isSafeInteger(attemptCount)) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The conversation outbox attempt is invalid.",
        );
      }
      return { leaseId, attemptCount, outbound: message };
    });
  }

  acknowledge(input: {
    outboundId: string;
    leaseId: string;
    receipt: ConversationDeliveryReceipt;
  }): void {
    if (!validateSchema("conversationDeliveryReceipt", input.receipt).valid) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation delivery receipt is invalid.",
      );
    }
    const row = this.database
      .prepare("SELECT * FROM conversation_outbox WHERE outbound_id = ?")
      .get(input.outboundId);
    if (row === undefined || row.status !== "leased" || row.lease_id !== input.leaseId) {
      throw new InteractionSQLiteError(
        "lease_mismatch",
        "The conversation outbox acknowledgement lease differs.",
      );
    }
    const eventRow = this.database
      .prepare("SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ?")
      .get(text(row, "source_event_id"), text(row, "role_id"));
    if (eventRow === undefined) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation outbox inbox source is missing.",
      );
    }
    const message = outbound(row, inbound(eventRow));
    const deliveredAtMs = milliseconds(input.receipt.deliveredAt, "Conversation delivery");
    if (
      input.receipt.outboundId !== message.outboundId ||
      input.receipt.integrationId !== message.target.integrationId ||
      deliveredAtMs < Date.parse(message.createdAt)
    )
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation receipt coordinates or time differ.",
      );
    const result = this.database
      .prepare(
        `
      UPDATE conversation_outbox SET status = 'delivered',
        lease_id = NULL, lease_owner = NULL, lease_expires_at_ms = NULL,
        receipt_json = ?, delivered_at_ms = ?
      WHERE outbound_id = ? AND lease_id = ? AND status = 'leased'
    `,
      )
      .run(canonicalJson(input.receipt), deliveredAtMs, input.outboundId, input.leaseId);
    if (result.changes !== 1) {
      throw new InteractionSQLiteError(
        "lease_mismatch",
        "Could not store the conversation delivery receipt.",
      );
    }
  }

  reschedule(input: {
    outboundId: string;
    leaseId: string;
    failedAt: string;
    availableAt: string;
    failureCode: string;
  }): void {
    const failedAtMs = milliseconds(input.failedAt, "Conversation delivery failure");
    const availableAtMs = milliseconds(input.availableAt, "Conversation delivery retry");
    failureCode(input.failureCode);
    if (availableAtMs < failedAtMs) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation delivery retry is earlier than the failure.",
      );
    }
    const result = this.database
      .prepare(
        `
      UPDATE conversation_outbox SET status = 'pending', available_at_ms = ?,
        lease_id = NULL, lease_owner = NULL, lease_expires_at_ms = NULL,
        last_failure_code = ?, last_failed_at_ms = ?
      WHERE outbound_id = ? AND lease_id = ? AND status = 'leased'
    `,
      )
      .run(availableAtMs, input.failureCode, failedAtMs, input.outboundId, input.leaseId);
    if (result.changes !== 1) {
      throw new InteractionSQLiteError(
        "lease_mismatch",
        "The conversation outbox retry lease differs.",
      );
    }
  }

  auditAll(): void {
    const rows = this.database
      .prepare("SELECT * FROM conversation_outbox ORDER BY outbound_id")
      .all();
    for (const row of rows) {
      const eventRow = this.database
        .prepare("SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ?")
        .get(text(row, "source_event_id"), text(row, "role_id"));
      if (eventRow === undefined) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The conversation outbox inbox source is missing.",
        );
      }
      const message = outbound(row, inbound(eventRow));
      const decisionRow = this.database
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
            {
              cause: error,
            },
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
}
