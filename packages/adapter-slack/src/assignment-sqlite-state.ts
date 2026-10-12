import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import {
  AssignmentConnectorPortError,
  type AssignmentConnectorDeliveryObservationV1,
  type AssignmentConnectorReservationV1,
  type AssignmentConnectorRoutePlanV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";

import {
  sameSlackAssignmentPlan,
  slackAssignmentObservation,
  SLACK_ASSIGNMENT_STATE_SCHEMA,
  type SlackAssignmentConnectorStateRow,
  type SlackAssignmentDurableStatus,
} from "./assignment-sqlite-record.js";
import type {
  SlackAssignmentConnectorStateV1,
  SlackAssignmentDeliveryStartV1,
} from "./assignment-types.js";

export interface SqliteSlackAssignmentConnectorStateOptionsV1 {
  maximumRecords?: number;
}

export class SqliteSlackAssignmentConnectorState implements SlackAssignmentConnectorStateV1 {
  private readonly maximumRecords: number;

  constructor(
    private readonly database: DatabaseSync,
    options: SqliteSlackAssignmentConnectorStateOptionsV1 = {},
  ) {
    this.maximumRecords = options.maximumRecords ?? 100_000;
    if (
      !Number.isSafeInteger(this.maximumRecords) ||
      this.maximumRecords < 1 ||
      this.maximumRecords > 1_000_000
    ) {
      throw new AssignmentConnectorPortError(
        "request_invalid",
        "The Slack assignment delivery-state capacity is invalid.",
      );
    }
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.database.exec(SLACK_ASSIGNMENT_STATE_SCHEMA);
  }

  static open(
    path: string,
    options: SqliteSlackAssignmentConnectorStateOptionsV1 = {},
  ): SqliteSlackAssignmentConnectorState {
    mkdirSync(dirname(path), { recursive: true });
    return new SqliteSlackAssignmentConnectorState(
      openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS }),
      options,
    );
  }

  async reserve(input: {
    plan: AssignmentConnectorRoutePlanV1;
    reservationId: string;
    authorizationReceiptHash: string;
    reservedAt: string;
  }): Promise<AssignmentConnectorReservationV1> {
    return this.transaction(() => {
      const current = this.find(input.plan.outboundId);
      if (current === null) {
        const count = this.database
          .prepare("SELECT COUNT(*) AS count FROM assignment_connector_delivery")
          .get() as { count: number };
        if (count.count >= this.maximumRecords) {
          throw new AssignmentConnectorPortError(
            "capacity_exceeded",
            "The Slack assignment delivery-state capacity has been reached.",
          );
        }
        this.database
          .prepare(
            `INSERT INTO assignment_connector_delivery (
              outbound_id, plan_id, connector_id, destination_id, reservation_id,
              attempt_digest, authorization_receipt_hash, reserved_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved')`,
          )
          .run(
            input.plan.outboundId,
            input.plan.planId,
            input.plan.connectorId,
            input.plan.destinationId,
            input.reservationId,
            input.plan.attemptDigest,
            input.authorizationReceiptHash,
            input.reservedAt,
          );
        return {
          status: "reserved",
          reservationId: input.reservationId,
          attemptDigest: input.plan.attemptDigest,
          authorizationReceiptHash: input.authorizationReceiptHash,
          reservedAt: input.reservedAt,
        };
      }
      if (
        !sameSlackAssignmentPlan(current, input.plan) ||
        current.reservation_id !== input.reservationId ||
        current.authorization_receipt_hash !== input.authorizationReceiptHash
      ) {
        return { status: "conflict", reason: "reservation_conflict" };
      }
      if (current.status === "reserved") {
        return {
          status: "reserved",
          reservationId: current.reservation_id,
          attemptDigest: current.attempt_digest,
          authorizationReceiptHash: current.authorization_receipt_hash,
          reservedAt: current.reserved_at,
        };
      }
      if (current.status === "sending") {
        this.markSendingUnknown(current);
        return {
          status: "current",
          observation: slackAssignmentObservation(this.find(current.outbound_id)!),
        };
      }
      return { status: "current", observation: slackAssignmentObservation(current) };
    });
  }

  async beginDelivery(input: {
    plan: AssignmentConnectorRoutePlanV1;
    reservationId: string;
    attemptedAt: string;
  }): Promise<SlackAssignmentDeliveryStartV1> {
    return this.transaction(() => {
      const current = this.find(input.plan.outboundId);
      if (
        current === null ||
        !sameSlackAssignmentPlan(current, input.plan) ||
        current.reservation_id !== input.reservationId
      ) {
        return { status: "conflict" };
      }
      if (current.status === "reserved") {
        this.database
          .prepare(
            `UPDATE assignment_connector_delivery
             SET status = 'sending', attempted_at = ?
             WHERE outbound_id = ? AND status = 'reserved'`,
          )
          .run(input.attemptedAt, input.plan.outboundId);
        return { status: "ready" };
      }
      if (current.status === "sending") {
        this.markSendingUnknown(current);
        return {
          status: "current",
          observation: slackAssignmentObservation(this.find(current.outbound_id)!),
        };
      }
      return { status: "current", observation: slackAssignmentObservation(current) };
    });
  }

  async complete(value: AssignmentConnectorDeliveryObservationV1): Promise<void> {
    this.transaction(() => {
      const current = this.find(value.outboundId);
      if (
        current === null ||
        current.plan_id !== value.planId ||
        current.connector_id !== value.connectorId ||
        current.destination_id !== value.destinationId ||
        current.reservation_id !== value.reservationId ||
        current.attempt_digest !== value.attemptDigest ||
        current.attempted_at !== value.attemptedAt
      ) {
        throw new AssignmentConnectorPortError(
          "delivery_state_invalid",
          "The Slack delivery observation differs from its durable reservation.",
        );
      }
      if (current.status === value.status) {
        const existing = slackAssignmentObservation(current);
        if (canonicalJson(existing) === canonicalJson(value)) return;
      }
      if (current.status !== "sending" && current.status !== "unknown") {
        throw new AssignmentConnectorPortError(
          "delivery_state_invalid",
          "The Slack delivery observation conflicts with a terminal result.",
        );
      }
      const result = this.database
        .prepare(
          `UPDATE assignment_connector_delivery
           SET status = ?, delivery_receipt_hash = ?, delivery_key_hash = ?, delivered_at = ?, failure_code = ?
           WHERE outbound_id = ? AND status IN ('sending', 'unknown')`,
        )
        .run(
          value.status,
          value.deliveryReceiptHash,
          value.deliveryKeyHash,
          value.deliveredAt,
          value.failureCode,
          value.outboundId,
        );
      if (result.changes !== 1) {
        throw new AssignmentConnectorPortError(
          "delivery_state_invalid",
          "The Slack delivery observation could not be committed.",
        );
      }
    });
  }

  listEvidence(limit = 1_000): AssignmentConnectorDeliveryObservationV1[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new AssignmentConnectorPortError(
        "request_invalid",
        "The Slack delivery evidence query limit is invalid.",
      );
    }
    return (
      this.database
        .prepare(
          `SELECT * FROM assignment_connector_delivery
           WHERE status IN ('delivered', 'rejected', 'unknown')
           ORDER BY reserved_at, outbound_id LIMIT ?`,
        )
        .all(limit) as unknown as SlackAssignmentConnectorStateRow[]
    ).map(slackAssignmentObservation);
  }

  inspectStatus(outboundId: string): SlackAssignmentDurableStatus | null {
    return this.find(outboundId)?.status ?? null;
  }

  purgeTerminal(input: { before: string; limit?: number }): number {
    const before = Date.parse(input.before);
    const limit = input.limit ?? 1_000;
    if (!Number.isFinite(before) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new AssignmentConnectorPortError(
        "request_invalid",
        "The Slack terminal-delivery retention request is invalid.",
      );
    }
    return this.transaction(() => {
      const result = this.database
        .prepare(
          `DELETE FROM assignment_connector_delivery
           WHERE outbound_id IN (
             SELECT outbound_id FROM assignment_connector_delivery
             WHERE status IN ('delivered', 'rejected', 'unknown')
               AND COALESCE(delivered_at, attempted_at) < ?
             ORDER BY COALESCE(delivered_at, attempted_at), outbound_id
             LIMIT ?
           )`,
        )
        .run(input.before, limit);
      return Number(result.changes);
    });
  }

  close(): void {
    this.database.close();
  }

  private find(outboundId: string): SlackAssignmentConnectorStateRow | null {
    return (
      (this.database
        .prepare("SELECT * FROM assignment_connector_delivery WHERE outbound_id = ?")
        .get(outboundId) as SlackAssignmentConnectorStateRow | undefined) ?? null
    );
  }

  private markSendingUnknown(row: SlackAssignmentConnectorStateRow): void {
    if (row.attempted_at === null) {
      throw new AssignmentConnectorPortError(
        "delivery_state_invalid",
        "The in-flight Slack delivery has no attempt time.",
      );
    }
    this.database
      .prepare(
        `UPDATE assignment_connector_delivery
         SET status = 'unknown', failure_code = 'platform_delivery_unknown'
         WHERE outbound_id = ? AND status = 'sending'`,
      )
      .run(row.outbound_id);
  }

  private transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch {
        // The transaction may already have ended after an underlying SQLite failure.
      }
      if (error instanceof AssignmentConnectorPortError) throw error;
      throw new AssignmentConnectorPortError(
        "delivery_state_invalid",
        "The durable Slack assignment delivery state is unavailable.",
        { cause: error },
      );
    }
  }
}
