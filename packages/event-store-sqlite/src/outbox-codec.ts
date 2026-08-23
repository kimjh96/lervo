import { type SQLOutputValue } from "node:sqlite";

import { type OutboxDelivery, type OutboxStatus } from "@lervo/storage-contract";

import { EventStoreError } from "./errors.js";
import {
  isOutboxFailureCode,
  isOutboxIdentifier,
  requireStoredOutboxTimestamp,
} from "./outbox-validation.js";
import { rowToEvent } from "./row-codec.js";

type SqliteRow = Record<string, SQLOutputValue>;

export function requireOutboxRowString(row: SqliteRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new EventStoreError("integrity_failed", `Outbox ${field} is not a string.`);
  }
  return value;
}

function optionalString(row: SqliteRow, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new EventStoreError("integrity_failed", `Outbox ${field} has an invalid format.`);
  }
  return value;
}

function requireAttemptCount(row: SqliteRow): number {
  const value = row.outbox_attempt_count;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EventStoreError("integrity_failed", "The outbox attempt count is invalid.");
  }
  return value;
}

function statusOf(row: SqliteRow): OutboxStatus {
  if (row.outbox_acknowledged_at !== null) return "acknowledged";
  if (row.outbox_lease_owner !== null) return "leased";
  return "pending";
}

export function rowToOutboxDelivery(row: SqliteRow): OutboxDelivery {
  const leaseOwner = optionalString(row, "outbox_lease_owner");
  const leaseStartedAt = optionalString(row, "outbox_lease_started_at");
  const leaseExpiresAt = optionalString(row, "outbox_lease_expires_at");
  const failureCode = optionalString(row, "outbox_last_failure_code");
  const failedAt = optionalString(row, "outbox_last_failed_at");
  if (
    (leaseOwner === null) !== (leaseStartedAt === null) ||
    (leaseOwner === null) !== (leaseExpiresAt === null)
  ) {
    throw new EventStoreError("integrity_failed", "The outbox lease coordinates are incomplete.");
  }
  if ((failureCode === null) !== (failedAt === null)) {
    throw new EventStoreError("integrity_failed", "The outbox failure coordinates are incomplete.");
  }
  const destinationId = requireOutboxRowString(row, "outbox_destination_id");
  const enqueuedAt = requireOutboxRowString(row, "outbox_enqueued_at");
  const availableAt = requireOutboxRowString(row, "outbox_available_at");
  const acknowledgedAt = optionalString(row, "outbox_acknowledged_at");
  if (!isOutboxIdentifier(destinationId)) {
    throw new EventStoreError("integrity_failed", "The outbox destinationId format is invalid.");
  }
  requireStoredOutboxTimestamp(enqueuedAt, "enqueuedAt");
  requireStoredOutboxTimestamp(availableAt, "availableAt");
  if (availableAt < enqueuedAt) {
    throw new EventStoreError("integrity_failed", "Outbox availableAt is earlier than enqueuedAt.");
  }
  if (leaseOwner !== null && !isOutboxIdentifier(leaseOwner)) {
    throw new EventStoreError("integrity_failed", "The outbox lease owner format is invalid.");
  }
  if (leaseExpiresAt !== null) {
    requireStoredOutboxTimestamp(leaseExpiresAt, "leaseExpiresAt");
  }
  if (leaseStartedAt !== null) {
    requireStoredOutboxTimestamp(leaseStartedAt, "leaseStartedAt");
  }
  if (
    leaseStartedAt !== null &&
    leaseExpiresAt !== null &&
    leaseStartedAt >= leaseExpiresAt
  ) {
    throw new EventStoreError("integrity_failed", "The outbox lease time range is invalid.");
  }
  if (failureCode !== null && !isOutboxFailureCode(failureCode)) {
    throw new EventStoreError("integrity_failed", "The outbox failure code format is invalid.");
  }
  if (failedAt !== null) requireStoredOutboxTimestamp(failedAt, "failedAt");
  if (acknowledgedAt !== null) {
    requireStoredOutboxTimestamp(acknowledgedAt, "acknowledgedAt");
  }
  if (acknowledgedAt !== null && leaseOwner !== null) {
    throw new EventStoreError("integrity_failed", "An acknowledged outbox item still has a lease.");
  }
  return {
    event: rowToEvent(row),
    destinationId,
    enqueuedAt,
    availableAt,
    attemptCount: requireAttemptCount(row),
    status: statusOf(row),
    lease:
      leaseOwner === null || leaseStartedAt === null || leaseExpiresAt === null
        ? null
        : { workerId: leaseOwner, claimedAt: leaseStartedAt, expiresAt: leaseExpiresAt },
    lastFailure:
      failureCode === null || failedAt === null
        ? null
        : { code: failureCode, failedAt },
    acknowledgedAt,
  };
}

export const outboxDeliverySelection = `
  SELECT
    e.*,
    o.destination_id AS outbox_destination_id,
    o.enqueued_at AS outbox_enqueued_at,
    o.available_at AS outbox_available_at,
    o.attempt_count AS outbox_attempt_count,
    o.lease_owner AS outbox_lease_owner,
    o.lease_started_at AS outbox_lease_started_at,
    o.lease_expires_at AS outbox_lease_expires_at,
    o.acknowledged_at AS outbox_acknowledged_at,
    o.last_failure_code AS outbox_last_failure_code,
    o.last_failed_at AS outbox_last_failed_at
  FROM outbox o
  JOIN events e ON e.event_id = o.event_id
`;
