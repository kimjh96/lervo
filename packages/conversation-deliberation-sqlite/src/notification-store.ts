import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  conversationDeliberationPatterns,
  type ConversationDeliberationNotification,
  type ConversationDeliberationNotificationOperation,
  type ConversationDeliberationNotificationStore,
} from "@lervo/conversation-deliberation-contract";

import { ConversationDeliberationSQLiteError } from "./errors.js";
import {
  conversationDeliberationMilliseconds,
  decodeConversationDeliberationSummary,
} from "./row-codec.js";
import { iterateSqliteRows, sqliteRow } from "./sqlite-row.js";

const table = "conversation_deliberation_notifications";

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation notification ${key} value is invalid.`,
    );
  }
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation notification ${key} value is invalid.`,
    );
  }
  return value;
}

function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `The conversation deliberation notification ${key} value is invalid.`,
    );
  }
  return value;
}

export function decodeConversationDeliberationNotification(
  row: Record<string, unknown>,
  operation: ConversationDeliberationNotificationOperation,
): ConversationDeliberationNotification {
  const projectId = text(row, "project_id");
  const deliberationId = text(row, "deliberation_id");
  const occurredAt = text(row, "occurred_at");
  const occurredAtMs = integer(row, "occurred_at_ms");
  const state = text(row, "state") as ConversationDeliberationNotification["state"];
  const attemptCount = integer(row, "attempt_count");
  const leaseId = nullableText(row, "lease_id");
  const leaseExpiresAt = nullableText(row, "lease_expires_at");
  const leaseExpiresAtMs = row.lease_expires_at_ms;
  const conversationEventId = nullableText(row, "conversation_event_id");
  const acceptedAt = nullableText(row, "accepted_at");
  const summary = decodeConversationDeliberationSummary(text(row, "summary_json"), deliberationId);
  if (
    !conversationDeliberationPatterns.projectId.test(projectId) ||
    !conversationDeliberationPatterns.deliberationId.test(deliberationId) ||
    summary === null ||
    summary.status === "running" ||
    summary.status === "unknown" ||
    conversationDeliberationMilliseconds(occurredAt, "deliberation notification") !==
      occurredAtMs ||
    !new Set(["pending", "leased", "accepted"]).has(state) ||
    attemptCount < 0 ||
    attemptCount > 100_000 ||
    (leaseId !== null && !/^cdn_[A-Za-z0-9_-]{32}$/u.test(leaseId)) ||
    (leaseExpiresAt !== null &&
      (typeof leaseExpiresAtMs !== "number" ||
        conversationDeliberationMilliseconds(
          leaseExpiresAt,
          "deliberation notification lease expiration",
        ) !== leaseExpiresAtMs)) ||
    (conversationEventId !== null &&
      !conversationDeliberationPatterns.sourceEventId.test(conversationEventId)) ||
    (acceptedAt !== null &&
      conversationDeliberationMilliseconds(acceptedAt, "deliberation notification acceptance") <
        occurredAtMs)
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation notification record is invalid.",
    );
  }
  return {
    operation,
    projectId,
    deliberationId,
    summary,
    occurredAt,
    state,
    attemptCount,
    leaseExpiresAt,
    conversationEventId,
    acceptedAt,
  };
}

function rollback(database: DatabaseSync, error: unknown): never {
  try {
    database.exec("ROLLBACK;");
  } catch (rollbackError) {
    throw new ConversationDeliberationSQLiteError(
      "write_failed",
      "The deliberation notification transaction and rollback both failed.",
      { cause: new AggregateError([error, rollbackError]) },
    );
  }
  if (error instanceof ConversationDeliberationSQLiteError) throw error;
  throw new ConversationDeliberationSQLiteError(
    "write_failed",
    "The deliberation notification transaction failed.",
    { cause: error },
  );
}

export function nextConversationDeliberationNotificationWakeupAt(
  database: DatabaseSync,
): number | null {
  const value = sqliteRow(
    database
      .prepare(
        `SELECT MIN(CASE WHEN state = 'pending' THEN occurred_at_ms ELSE lease_expires_at_ms END) AS next_at FROM ${table} WHERE state IN ('pending', 'leased')`,
      )
      .get(),
  )?.next_at;
  return typeof value === "number" ? value : null;
}

export function checkConversationDeliberationNotificationIntegrity(input: {
  database: DatabaseSync;
  operation: ConversationDeliberationNotificationOperation;
  maximumRecords: number;
}): void {
  let count = 0;
  for (const row of iterateSqliteRows(input.database.prepare(`SELECT * FROM ${table}`).iterate())) {
    count += 1;
    if (count > input.maximumRecords) {
      throw new ConversationDeliberationSQLiteError(
        "capacity_exceeded",
        "The deliberation notification capacity was exceeded.",
      );
    }
    decodeConversationDeliberationNotification(row, input.operation);
  }
}

export function claimConversationDeliberationNotification(input: {
  database: DatabaseSync;
  operation: ConversationDeliberationNotificationOperation;
  workerId: string;
  claimedAt: string;
  leaseDurationMs: number;
}): { leaseId: string; notification: ConversationDeliberationNotification } | null {
  if (
    !conversationDeliberationPatterns.workerId.test(input.workerId) ||
    !Number.isSafeInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < 10_000 ||
    input.leaseDurationMs > 60 * 60_000
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The deliberation notification lease configuration is invalid.",
    );
  }
  const claimedAtMs = conversationDeliberationMilliseconds(
    input.claimedAt,
    "deliberation notification claim",
  );
  input.database.exec("BEGIN IMMEDIATE;");
  try {
    const row = sqliteRow(
      input.database
        .prepare(
          `SELECT * FROM ${table} WHERE state = 'pending' OR (state = 'leased' AND lease_expires_at_ms <= ?) ORDER BY occurred_at_ms, deliberation_id LIMIT 1`,
        )
        .get(claimedAtMs),
    );
    if (row === undefined) {
      input.database.exec("COMMIT;");
      return null;
    }
    const notification = decodeConversationDeliberationNotification(row, input.operation);
    const leaseId = `cdn_${randomBytes(24).toString("base64url")}`;
    const leaseExpiresAtMs = claimedAtMs + input.leaseDurationMs;
    const updated = input.database
      .prepare(
        `UPDATE ${table} SET state = 'leased', attempt_count = attempt_count + 1, lease_id = ?, lease_owner = ?, lease_expires_at = ?, lease_expires_at_ms = ? WHERE project_id = ? AND deliberation_id = ? AND state != 'accepted'`,
      )
      .run(
        leaseId,
        input.workerId,
        new Date(leaseExpiresAtMs).toISOString(),
        leaseExpiresAtMs,
        notification.projectId,
        notification.deliberationId,
      );
    if (updated.changes !== 1) {
      throw new ConversationDeliberationSQLiteError(
        "lease_mismatch",
        "Could not acquire the deliberation notification lease.",
      );
    }
    const leased = sqliteRow(
      input.database
        .prepare(`SELECT * FROM ${table} WHERE project_id = ? AND deliberation_id = ?`)
        .get(notification.projectId, notification.deliberationId),
    );
    input.database.exec("COMMIT;");
    return {
      leaseId,
      notification: decodeConversationDeliberationNotification(leased!, input.operation),
    };
  } catch (error) {
    rollback(input.database, error);
  }
}

export function acceptConversationDeliberationNotification(input: {
  database: DatabaseSync;
  deliberationId: string;
  leaseId: string;
  conversationEventId: string;
  acceptedAt: string;
}): void {
  if (
    !conversationDeliberationPatterns.deliberationId.test(input.deliberationId) ||
    !/^cdn_[A-Za-z0-9_-]{32}$/u.test(input.leaseId) ||
    !conversationDeliberationPatterns.sourceEventId.test(input.conversationEventId)
  ) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The deliberation notification acceptance coordinates are invalid.",
    );
  }
  const acceptedAtMs = conversationDeliberationMilliseconds(
    input.acceptedAt,
    "deliberation notification acceptance",
  );
  const updated = input.database
    .prepare(
      `UPDATE ${table} SET state = 'accepted', lease_id = NULL, lease_owner = NULL, lease_expires_at = NULL, lease_expires_at_ms = NULL, conversation_event_id = ?, accepted_at = ?, accepted_at_ms = ? WHERE deliberation_id = ? AND state = 'leased' AND lease_id = ? AND occurred_at_ms <= ?`,
    )
    .run(
      input.conversationEventId,
      input.acceptedAt,
      acceptedAtMs,
      input.deliberationId,
      input.leaseId,
      acceptedAtMs,
    );
  if (updated.changes !== 1) {
    throw new ConversationDeliberationSQLiteError(
      "lease_mismatch",
      "The deliberation notification acceptance lease differs.",
    );
  }
}

export function notificationStoreMethods(
  database: DatabaseSync,
  operation: ConversationDeliberationNotificationOperation,
): Pick<ConversationDeliberationNotificationStore, "claimNotification" | "acceptNotification"> {
  return {
    claimNotification: async (input) =>
      claimConversationDeliberationNotification({ database, operation, ...input }),
    acceptNotification: async (input) =>
      acceptConversationDeliberationNotification({ database, ...input }),
  };
}
