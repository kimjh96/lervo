import { type DatabaseSync } from "node:sqlite";

import {
  type AcknowledgeOutboxRequest,
  type AcknowledgeOutboxResult,
  type ClaimOutboxRequest,
  type EnqueueOutboxRequest,
  type EnqueueOutboxResult,
  type ListOutboxOptions,
  type OutboxDelivery,
  type PurgeAcknowledgedOutboxRequest,
  type PurgeAcknowledgedOutboxResult,
  type RescheduleOutboxRequest,
  type RescheduleOutboxResult,
} from "@lervo/storage-contract";

import { EventStoreError } from "./errors.js";
import {
  outboxDeliverySelection,
  requireOutboxRowString,
  rowToOutboxDelivery,
} from "./outbox-codec.js";
import {
  requireOutboxFailureCode,
  requireOutboxIdentifier,
  requireOutboxPositiveInteger,
  requireOutboxTimestamp,
} from "./outbox-validation.js";

export class SQLiteOutboxRepository {
  constructor(private readonly database: DatabaseSync) {}

  enqueue(request: EnqueueOutboxRequest): EnqueueOutboxResult {
    const eventId = requireOutboxIdentifier(request.eventId, "eventId");
    const destinationId = requireOutboxIdentifier(request.destinationId, "destinationId");
    const enqueuedAt = requireOutboxTimestamp(request.enqueuedAt, "enqueuedAt");
    const availableAt = requireOutboxTimestamp(
      request.availableAt ?? request.enqueuedAt,
      "availableAt",
    );
    if (availableAt < enqueuedAt) {
      throw new EventStoreError(
        "invalid_outbox_request",
        "availableAt cannot be earlier than enqueuedAt.",
      );
    }
    const existing = this.database
      .prepare("SELECT 1 FROM outbox WHERE event_id = ? AND destination_id = ?")
      .get(eventId, destinationId);
    if (existing) return { inserted: false };
    const event = this.database.prepare("SELECT 1 FROM events WHERE event_id = ?").get(eventId);
    if (!event) {
      throw new EventStoreError(
        "outbox_not_found",
        `Event ${eventId} to enqueue in the outbox is missing.`,
      );
    }
    this.database
      .prepare(
        `
        INSERT INTO outbox (
          event_id, destination_id, enqueued_at, available_at
        ) VALUES (?, ?, ?, ?)
      `,
      )
      .run(eventId, destinationId, enqueuedAt, availableAt);
    return { inserted: true };
  }

  outstandingCount(destinationId: string): number {
    const destination = requireOutboxIdentifier(destinationId, "destinationId");
    const row = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM outbox WHERE destination_id = ? AND acknowledged_at IS NULL",
      )
      .get(destination);
    if (typeof row?.count !== "number") {
      throw new EventStoreError("integrity_failed", "The outstanding outbox count is invalid.");
    }
    return row.count;
  }

  get(eventId: string, destinationId: string): OutboxDelivery | null {
    const event = requireOutboxIdentifier(eventId, "eventId");
    const destination = requireOutboxIdentifier(destinationId, "destinationId");
    const row = this.database
      .prepare(`${outboxDeliverySelection} WHERE o.event_id = ? AND o.destination_id = ?`)
      .get(event, destination);
    return row === undefined ? null : rowToOutboxDelivery(row);
  }

  claim(request: ClaimOutboxRequest): OutboxDelivery[] {
    const workerId = requireOutboxIdentifier(request.workerId, "workerId");
    const claimedAt = requireOutboxTimestamp(request.claimedAt, "claimedAt");
    const leaseDurationMs = requireOutboxPositiveInteger(
      request.leaseDurationMs,
      "leaseDurationMs",
      86_400_000,
    );
    const limit = requireOutboxPositiveInteger(request.limit ?? 1, "limit", 100);
    const destinationId =
      request.destinationId === undefined
        ? undefined
        : requireOutboxIdentifier(request.destinationId, "destinationId");
    const leaseExpiresAt = new Date(Date.parse(claimedAt) + leaseDurationMs).toISOString();
    const candidates = destinationId
      ? this.database
          .prepare(
            `
            SELECT event_id, destination_id
            FROM outbox
            WHERE acknowledged_at IS NULL
              AND available_at <= ?
              AND (lease_owner IS NULL OR lease_expires_at <= ?)
              AND destination_id = ?
            ORDER BY available_at, enqueued_at, event_id, destination_id
            LIMIT ?
          `,
          )
          .all(claimedAt, claimedAt, destinationId, limit)
      : this.database
          .prepare(
            `
            SELECT event_id, destination_id
            FROM outbox
            WHERE acknowledged_at IS NULL
              AND available_at <= ?
              AND (lease_owner IS NULL OR lease_expires_at <= ?)
            ORDER BY available_at, enqueued_at, event_id, destination_id
            LIMIT ?
          `,
          )
          .all(claimedAt, claimedAt, limit);

    const deliveries: OutboxDelivery[] = [];
    const lease = this.database.prepare(`
      UPDATE outbox
      SET lease_owner = ?, lease_started_at = ?, lease_expires_at = ?,
          attempt_count = attempt_count + 1
      WHERE event_id = ? AND destination_id = ?
        AND acknowledged_at IS NULL
        AND available_at <= ?
        AND (lease_owner IS NULL OR lease_expires_at <= ?)
    `);
    const read = this.database.prepare(
      `${outboxDeliverySelection} WHERE o.event_id = ? AND o.destination_id = ?`,
    );
    for (const candidate of candidates) {
      const eventId = requireOutboxRowString(candidate, "event_id");
      const selectedDestination = requireOutboxRowString(candidate, "destination_id");
      const result = lease.run(
        workerId,
        claimedAt,
        leaseExpiresAt,
        eventId,
        selectedDestination,
        claimedAt,
        claimedAt,
      );
      if (result.changes !== 1) continue;
      const row = read.get(eventId, selectedDestination);
      if (!row) {
        throw new EventStoreError("integrity_failed", "The leased outbox item cannot be read.");
      }
      deliveries.push(rowToOutboxDelivery(row));
    }
    return deliveries;
  }

  acknowledge(request: AcknowledgeOutboxRequest): AcknowledgeOutboxResult {
    const eventId = requireOutboxIdentifier(request.eventId, "eventId");
    const destinationId = requireOutboxIdentifier(request.destinationId, "destinationId");
    const workerId = requireOutboxIdentifier(request.workerId, "workerId");
    const acknowledgedAt = requireOutboxTimestamp(request.acknowledgedAt, "acknowledgedAt");
    const row = this.database
      .prepare("SELECT * FROM outbox WHERE event_id = ? AND destination_id = ?")
      .get(eventId, destinationId);
    if (!row)
      throw new EventStoreError("outbox_not_found", "The outbox item to acknowledge is missing.");
    if (row.acknowledged_at !== null) return { acknowledged: false };
    if (
      row.lease_owner !== workerId ||
      typeof row.lease_started_at !== "string" ||
      typeof row.lease_expires_at !== "string"
    ) {
      throw new EventStoreError(
        "outbox_lease_conflict",
        "The lease is not held by the current worker.",
      );
    }
    if (acknowledgedAt < row.lease_started_at || row.lease_expires_at <= acknowledgedAt) {
      throw new EventStoreError(
        "outbox_lease_conflict",
        "The item cannot be acknowledged at a time outside the lease validity interval.",
      );
    }
    this.database
      .prepare(
        `
        UPDATE outbox
        SET acknowledged_at = ?, lease_owner = NULL,
            lease_started_at = NULL, lease_expires_at = NULL
        WHERE event_id = ? AND destination_id = ?
      `,
      )
      .run(acknowledgedAt, eventId, destinationId);
    return { acknowledged: true };
  }

  reschedule(request: RescheduleOutboxRequest): RescheduleOutboxResult {
    const eventId = requireOutboxIdentifier(request.eventId, "eventId");
    const destinationId = requireOutboxIdentifier(request.destinationId, "destinationId");
    const workerId = requireOutboxIdentifier(request.workerId, "workerId");
    const failedAt = requireOutboxTimestamp(request.failedAt, "failedAt");
    const availableAt = requireOutboxTimestamp(request.availableAt, "availableAt");
    const failureCode = requireOutboxFailureCode(request.failureCode);
    if (availableAt < failedAt) {
      throw new EventStoreError(
        "invalid_outbox_request",
        "availableAt cannot be earlier than failedAt.",
      );
    }
    const row = this.database
      .prepare("SELECT * FROM outbox WHERE event_id = ? AND destination_id = ?")
      .get(eventId, destinationId);
    if (!row) throw new EventStoreError("outbox_not_found", "The outbox item to retry is missing.");
    if (
      row.acknowledged_at !== null ||
      row.lease_owner !== workerId ||
      typeof row.lease_started_at !== "string" ||
      typeof row.lease_expires_at !== "string" ||
      failedAt < row.lease_started_at ||
      row.lease_expires_at <= failedAt
    ) {
      throw new EventStoreError(
        "outbox_lease_conflict",
        "Only the worker holding the current valid lease can schedule a retry.",
      );
    }
    this.database
      .prepare(
        `
        UPDATE outbox
        SET available_at = ?, lease_owner = NULL,
            lease_started_at = NULL, lease_expires_at = NULL,
            last_failure_code = ?, last_failed_at = ?
        WHERE event_id = ? AND destination_id = ?
      `,
      )
      .run(availableAt, failureCode, failedAt, eventId, destinationId);
    return { rescheduled: true };
  }

  purgeAcknowledged(request: PurgeAcknowledgedOutboxRequest): PurgeAcknowledgedOutboxResult {
    const before = requireOutboxTimestamp(request.before, "before");
    const limit = requireOutboxPositiveInteger(request.limit ?? 100, "limit", 1_000);
    const result = this.database
      .prepare(
        `
        DELETE FROM outbox
        WHERE rowid IN (
          SELECT rowid
          FROM outbox
          WHERE acknowledged_at IS NOT NULL AND acknowledged_at < ?
          ORDER BY acknowledged_at, event_id, destination_id
          LIMIT ?
        )
      `,
      )
      .run(before, limit);
    return { deleted: Number(result.changes) };
  }

  list(options: ListOutboxOptions = {}): OutboxDelivery[] {
    const limit = requireOutboxPositiveInteger(options.limit ?? 100, "limit", 1_000);
    const destinationId =
      options.destinationId === undefined
        ? undefined
        : requireOutboxIdentifier(options.destinationId, "destinationId");
    const status = options.status;
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (destinationId !== undefined) {
      clauses.push("o.destination_id = ?");
      parameters.push(destinationId);
    }
    if (status === "pending") clauses.push("o.acknowledged_at IS NULL AND o.lease_owner IS NULL");
    else if (status === "leased")
      clauses.push("o.acknowledged_at IS NULL AND o.lease_owner IS NOT NULL");
    else if (status === "acknowledged") clauses.push("o.acknowledged_at IS NOT NULL");
    else if (status !== undefined) {
      throw new EventStoreError("invalid_outbox_request", "The outbox status is unsupported.");
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = this.database
      .prepare(
        `${outboxDeliverySelection} ${where} ORDER BY o.enqueued_at, o.event_id, o.destination_id LIMIT ?`,
      )
      .all(...parameters, limit);
    return rows.map(rowToOutboxDelivery);
  }

  verifyIntegrity(): number {
    let count = 0;
    const rows = this.database
      .prepare(`${outboxDeliverySelection} ORDER BY o.enqueued_at, o.event_id, o.destination_id`)
      .iterate();
    for (const row of rows) {
      rowToOutboxDelivery(row);
      count += 1;
    }
    return count;
  }
}
