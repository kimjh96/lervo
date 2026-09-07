import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  LiveTriggerAdmissionPlanV1,
  LiveTriggerCompletionV1,
  LiveTriggerReservationDecisionV1,
  LiveTriggerReservationStoreV1,
} from "@lervo/live-trigger-contract";

import {
  configureLiveTriggerDatabase,
  ensureLiveTriggerDatabasePath,
  migrateLiveTriggerDatabase,
} from "./database.js";
import { LiveTriggerSQLiteError } from "./errors.js";
import {
  assertCompletion,
  assertReservationPlan,
  decodeCompletion,
  decodeReservationRow,
} from "./row-codec.js";

export class SQLiteLiveTriggerReservationStore implements LiveTriggerReservationStoreV1 {
  readonly path: string;
  private closed = false;

  private constructor(
    path: string,
    private readonly database: DatabaseSync,
    private readonly maxRecords: number,
  ) {
    this.path = path;
  }

  static async open(options: {
    path: string;
    maxRecords?: number;
  }): Promise<SQLiteLiveTriggerReservationStore> {
    const maxRecords = options.maxRecords ?? 100_000;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000_000) {
      throw new LiveTriggerSQLiteError("integrity_failed", "Invalid live-trigger capacity.");
    }
    const path = await ensureLiveTriggerDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureLiveTriggerDatabase(database);
      migrateLiveTriggerDatabase(database);
      const store = new SQLiteLiveTriggerReservationStore(path, database, maxRecords);
      store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new LiveTriggerSQLiteError("closed", "Live-trigger store is closed.");
  }

  async reserve(plan: LiveTriggerAdmissionPlanV1): Promise<LiveTriggerReservationDecisionV1> {
    this.assertOpen();
    assertReservationPlan(plan);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const rawExisting = this.database
        .prepare(
          `SELECT reservation_id, invocation_fingerprint_hash, plan_id, status,
          completion_json FROM live_trigger_reservation WHERE source_event_key_hash = ?`,
        )
        .get(plan.sourceEventKeyHash);
      const existing = rawExisting === undefined ? undefined : decodeReservationRow(rawExisting);
      if (existing !== undefined) {
        if (
          existing.invocation_fingerprint_hash !== plan.invocationFingerprintHash ||
          existing.plan_id !== plan.planId
        ) {
          this.database.exec("COMMIT;");
          return { status: "idempotency_conflict" };
        }
        let decision: LiveTriggerReservationDecisionV1;
        if (existing.status === "completed") {
          decision = {
            status: "current",
            completion: decodeCompletion(existing.completion_json, plan.planId),
          };
        } else if (existing.status === "recovery_required") {
          decision = {
            status: "recoverable",
            reservationId: existing.reservation_id,
            recovery: true,
          };
        } else {
          decision = { status: "in_progress" };
        }
        this.database.exec("COMMIT;");
        return decision;
      }
      const authorizationCount =
        this.database
          .prepare(
            "SELECT accepted_count FROM live_trigger_authorization_usage WHERE authorization_hash = ?",
          )
          .get(plan.authorizationHash)?.accepted_count ?? 0;
      if (typeof authorizationCount !== "number" || !Number.isSafeInteger(authorizationCount)) {
        throw new LiveTriggerSQLiteError("integrity_failed", "Invalid authorization count.");
      }
      if (authorizationCount >= plan.maximumAcceptedTriggers) {
        this.database.exec("COMMIT;");
        return { status: "budget_exhausted" };
      }
      if (authorizationCount === 0) {
        const authorizationTotal = this.database
          .prepare("SELECT COUNT(*) AS count FROM live_trigger_authorization_usage")
          .get()?.count;
        if (typeof authorizationTotal !== "number" || !Number.isSafeInteger(authorizationTotal)) {
          throw new LiveTriggerSQLiteError("integrity_failed", "Invalid authorization total.");
        }
        if (authorizationTotal >= this.maxRecords) {
          this.database.exec("COMMIT;");
          return { status: "capacity_exhausted" };
        }
      }
      const total = this.database
        .prepare("SELECT COUNT(*) AS count FROM live_trigger_reservation")
        .get()?.count;
      if (typeof total !== "number" || !Number.isSafeInteger(total)) {
        throw new LiveTriggerSQLiteError("integrity_failed", "Invalid reservation count.");
      }
      if (total >= this.maxRecords) {
        this.database.exec("COMMIT;");
        return { status: "capacity_exhausted" };
      }
      const reservationId = `ltr_${randomBytes(24).toString("base64url")}`;
      this.database
        .prepare(
          `INSERT INTO live_trigger_reservation (
          source_event_key_hash, reservation_id, invocation_fingerprint_hash, plan_id,
          authorization_hash, status, completion_json, reserved_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'reserved', NULL, ?, ?)`,
        )
        .run(
          plan.sourceEventKeyHash,
          reservationId,
          plan.invocationFingerprintHash,
          plan.planId,
          plan.authorizationHash,
          plan.admittedAt,
          plan.admittedAt,
        );
      this.database
        .prepare(
          `INSERT INTO live_trigger_authorization_usage (authorization_hash, accepted_count)
          VALUES (?, 1) ON CONFLICT(authorization_hash)
          DO UPDATE SET accepted_count = accepted_count + 1`,
        )
        .run(plan.authorizationHash);
      this.database.exec("COMMIT;");
      return { status: "reserved", reservationId, recovery: false };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new LiveTriggerSQLiteError("write_failed", "Reservation and rollback failed.", {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      if (error instanceof LiveTriggerSQLiteError) throw error;
      throw new LiveTriggerSQLiteError("write_failed", "Reservation could not be saved.", {
        cause: error,
      });
    }
  }

  async complete(input: {
    reservationId: string;
    completion: LiveTriggerCompletionV1;
  }): Promise<void> {
    this.assertOpen();
    assertCompletion(input.completion);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const rawRow = this.database
        .prepare(
          `SELECT reservation_id, invocation_fingerprint_hash, plan_id, status,
          completion_json FROM live_trigger_reservation WHERE reservation_id = ?`,
        )
        .get(input.reservationId);
      const row = rawRow === undefined ? undefined : decodeReservationRow(rawRow);
      if (row === undefined || row.plan_id !== input.completion.planId) {
        throw new LiveTriggerSQLiteError("write_failed", "Completion does not match reservation.");
      }
      if (row.status === "completed") {
        const current = decodeCompletion(row.completion_json, row.plan_id);
        if (JSON.stringify(current) !== JSON.stringify(input.completion)) {
          throw new LiveTriggerSQLiteError(
            "write_failed",
            "Completion conflicts with current evidence.",
          );
        }
      } else {
        this.database
          .prepare(
            `UPDATE live_trigger_reservation SET status = 'completed', completion_json = ?,
            updated_at = ? WHERE reservation_id = ?`,
          )
          .run(JSON.stringify(input.completion), input.completion.completedAt, input.reservationId);
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async requireRecovery(input: { reservationId: string; failedAt: string }): Promise<void> {
    this.assertOpen();
    if (!Number.isFinite(Date.parse(input.failedAt))) {
      throw new LiveTriggerSQLiteError("integrity_failed", "Invalid recovery time.");
    }
    const result = this.database
      .prepare(
        `UPDATE live_trigger_reservation SET status = 'recovery_required', updated_at = ?
        WHERE reservation_id = ? AND status IN ('reserved', 'recovery_required')`,
      )
      .run(input.failedAt, input.reservationId);
    if (result.changes !== 1) {
      const completed = this.database
        .prepare(
          "SELECT 1 AS found FROM live_trigger_reservation WHERE reservation_id = ? AND status = 'completed'",
        )
        .get(input.reservationId);
      if (completed === undefined) {
        throw new LiveTriggerSQLiteError("write_failed", "Recovery reservation was not found.");
      }
    }
  }

  async pruneCompleted(input: { before: string; limit: number }): Promise<number> {
    this.assertOpen();
    if (
      !Number.isFinite(Date.parse(input.before)) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000
    ) {
      throw new LiveTriggerSQLiteError("integrity_failed", "Invalid retention boundary.");
    }
    const result = this.database
      .prepare(
        `DELETE FROM live_trigger_reservation WHERE source_event_key_hash IN (
        SELECT source_event_key_hash FROM live_trigger_reservation
        WHERE status = 'completed' AND updated_at < ? ORDER BY updated_at ASC LIMIT ?
      )`,
      )
      .run(input.before, input.limit);
    return Number(result.changes);
  }

  async recoverUnfinished(input: { before: string; limit: number }): Promise<number> {
    this.assertOpen();
    if (
      !Number.isFinite(Date.parse(input.before)) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000
    ) {
      throw new LiveTriggerSQLiteError("integrity_failed", "Invalid recovery boundary.");
    }
    const result = this.database
      .prepare(
        `UPDATE live_trigger_reservation SET status = 'recovery_required', updated_at = ?
        WHERE source_event_key_hash IN (
          SELECT source_event_key_hash FROM live_trigger_reservation
          WHERE status = 'reserved' AND updated_at < ? ORDER BY updated_at ASC LIMIT ?
        )`,
      )
      .run(new Date().toISOString(), input.before, input.limit);
    return Number(result.changes);
  }

  checkIntegrity(): void {
    this.assertOpen();
    if (this.database.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") {
      throw new LiveTriggerSQLiteError("integrity_failed", "Live-trigger quick_check failed.");
    }
    const requiredTriggers = new Set([
      "live_trigger_authorization_usage_monotonic",
      "live_trigger_authorization_usage_no_delete",
      "live_trigger_coordinates_immutable",
      "live_trigger_status_forward",
    ]);
    for (const row of this.database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger'")
      .all()) {
      if (typeof row.name === "string") requiredTriggers.delete(row.name);
    }
    const undercount = this.database
      .prepare(
        `SELECT 1 AS found
      FROM live_trigger_authorization_usage usage
      WHERE usage.accepted_count < (
        SELECT COUNT(*) FROM live_trigger_reservation reservation
        WHERE reservation.authorization_hash = usage.authorization_hash
      ) LIMIT 1`,
      )
      .get();
    if (requiredTriggers.size !== 0 || undercount !== undefined) {
      throw new LiveTriggerSQLiteError(
        "integrity_failed",
        "Live-trigger integrity evidence is incomplete.",
      );
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
