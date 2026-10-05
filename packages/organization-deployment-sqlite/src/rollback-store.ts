import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  assertOrganizationNodeRollbackDeliveryReceipt,
  assertOrganizationNodeRollbackRecoveryReceipt,
  assertOrganizationNodeRolloutRecoveryObservation,
  type OrganizationNodeRollbackDeliveryReplayDecision,
  type OrganizationNodeRollbackDeliveryReplayStore,
  type OrganizationNodeRollbackDeliveryReservationDecision,
  type OrganizationNodeRollbackRecoveryStateDecision,
} from "@lervo/organization-deployment-contract";
import type {
  OrganizationNodeRollbackDeliveryReceipt,
  OrganizationNodeRollbackRecoveryReceipt,
  OrganizationNodeRolloutRecoveryObservation,
  OrganizationProjectTarget,
} from "@lervo/schemas";

import {
  configureOrganizationRolloutDatabase,
  ensureOrganizationRolloutDatabasePath,
  migrateOrganizationRolloutDatabase,
} from "./database.js";
import { OrganizationDeploymentSQLiteError } from "./errors.js";
import { assertReplayCoordinate } from "./replay-record.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

interface RollbackReplayRow {
  idempotencyKey: string;
  deliveryHash: string;
  nonce: string;
  reservationId: string;
  receipt: OrganizationNodeRollbackDeliveryReceipt | null;
  baseline: OrganizationNodeRolloutRecoveryObservation;
  recovery: OrganizationNodeRollbackRecoveryReceipt | null;
}

function parsed<T>(value: unknown, assertValue: (candidate: T) => void, label: string): T | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new OrganizationDeploymentSQLiteError("integrity_failed", `${label} is invalid.`);
  }
  try {
    const candidate = JSON.parse(value) as T;
    assertValue(candidate);
    return structuredClone(candidate);
  } catch (error) {
    throw new OrganizationDeploymentSQLiteError("integrity_failed", `${label} is invalid.`, {
      cause: error,
    });
  }
}

function stringField(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== "string") {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "An organization rollback replay row is invalid.",
    );
  }
  return value;
}

function decodeRow(row: Record<string, unknown>): RollbackReplayRow {
  const decoded = {
    idempotencyKey: stringField(row, "idempotency_key"),
    deliveryHash: stringField(row, "delivery_hash"),
    nonce: stringField(row, "nonce"),
    reservationId: stringField(row, "reservation_id"),
    receipt: parsed(
      row.receipt_json,
      assertOrganizationNodeRollbackDeliveryReceipt,
      "The organization rollback delivery receipt",
    ),
    baseline: parsed(
      row.baseline_json,
      assertOrganizationNodeRolloutRecoveryObservation,
      "The organization rollback recovery baseline",
    ),
    recovery: parsed(
      row.recovery_json,
      assertOrganizationNodeRollbackRecoveryReceipt,
      "The organization rollback recovery receipt",
    ),
  };
  if (decoded.baseline === null) {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "The organization rollback recovery baseline is missing.",
    );
  }
  assertReplayCoordinate({
    idempotencyKey: decoded.idempotencyKey,
    deliveryHash: decoded.deliveryHash,
    nonce: decoded.nonce,
  });
  if (
    (decoded.receipt !== null &&
      (decoded.receipt.deliveryHash !== decoded.deliveryHash ||
        decoded.receipt.idempotencyKey !== decoded.idempotencyKey)) ||
    (decoded.recovery !== null &&
      (decoded.recovery.deliveryHash !== decoded.deliveryHash ||
        decoded.recovery.idempotencyKey !== decoded.idempotencyKey))
  ) {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "An organization rollback replay receipt has conflicting coordinates.",
    );
  }
  return decoded as RollbackReplayRow;
}

const SELECT_ROW = `SELECT idempotency_key, delivery_hash, nonce, reservation_id,
                            receipt_json, baseline_json, recovery_json
                     FROM organization_rollback_replay`;

export class SQLiteOrganizationNodeRollbackReplayStore implements OrganizationNodeRollbackDeliveryReplayStore {
  readonly path: string;
  private closed = false;

  private constructor(
    path: string,
    private readonly database: DatabaseSync,
    private readonly maximumRecords: number,
  ) {
    this.path = path;
  }

  static async open(input: {
    path: string;
    target: OrganizationProjectTarget;
    nodeId: string;
    destinationId: string;
    maximumRecords?: number;
  }): Promise<SQLiteOrganizationNodeRollbackReplayStore> {
    const maximumRecords = input.maximumRecords ?? 1_024;
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 100_000) {
      throw new OrganizationDeploymentSQLiteError(
        "integrity_failed",
        "The organization rollback replay capacity is invalid.",
      );
    }
    const path = await ensureOrganizationRolloutDatabasePath(input.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureOrganizationRolloutDatabase(database);
      migrateOrganizationRolloutDatabase(database);
      const store = new SQLiteOrganizationNodeRollbackReplayStore(path, database, maximumRecords);
      store.bindTarget(input);
      store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private bindTarget(input: {
    target: OrganizationProjectTarget;
    nodeId: string;
    destinationId: string;
  }): void {
    const expected = new Map([
      ["project_id", input.target.projectId],
      ["project_identity_hash", input.target.projectIdentityHash],
      ["node_id", input.nodeId],
      ["destination_id", input.destinationId],
    ]);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const rows = sqliteRows(
        this.database
          .prepare("SELECT key, value FROM organization_rollout_meta ORDER BY key")
          .all(),
      );
      if (rows.length === 0) {
        const insert = this.database.prepare(
          "INSERT INTO organization_rollout_meta (key, value) VALUES (?, ?)",
        );
        for (const [key, value] of expected) insert.run(key, value);
      } else if (
        rows.length !== expected.size ||
        rows.some(
          (row) =>
            typeof row.key !== "string" ||
            typeof row.value !== "string" ||
            expected.get(row.key) !== row.value,
        )
      ) {
        throw new OrganizationDeploymentSQLiteError(
          "integrity_failed",
          "The organization rollback replay database belongs to a different target.",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new OrganizationDeploymentSQLiteError("closed", "The store is closed.");
  }

  private inspectCurrent(coordinate: {
    deliveryHash: string;
    idempotencyKey: string;
    nonce: string;
  }): OrganizationNodeRollbackDeliveryReplayDecision {
    assertReplayCoordinate(coordinate);
    const candidate = sqliteRow(
      this.database
        .prepare(`${SELECT_ROW} WHERE idempotency_key = ?`)
        .get(coordinate.idempotencyKey),
    );
    if (candidate !== undefined) {
      const row = decodeRow(candidate);
      if (row.deliveryHash !== coordinate.deliveryHash || row.nonce !== coordinate.nonce) {
        return { status: "idempotency_conflict" };
      }
      return row.receipt === null
        ? { status: "in_progress" }
        : { status: "duplicate", receipt: row.receipt };
    }
    const nonce = sqliteRow(
      this.database
        .prepare("SELECT idempotency_key FROM organization_rollback_replay WHERE nonce = ?")
        .get(coordinate.nonce),
    );
    return nonce === undefined ? { status: "available" } : { status: "nonce_replay" };
  }

  async inspect(
    coordinate: Parameters<OrganizationNodeRollbackDeliveryReplayStore["inspect"]>[0],
  ): Promise<OrganizationNodeRollbackDeliveryReplayDecision> {
    this.assertOpen();
    return this.inspectCurrent(coordinate);
  }

  async reserve(
    coordinate: Parameters<OrganizationNodeRollbackDeliveryReplayStore["reserve"]>[0],
  ): Promise<OrganizationNodeRollbackDeliveryReservationDecision> {
    this.assertOpen();
    assertOrganizationNodeRolloutRecoveryObservation(coordinate.baseline);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const decision = this.inspectCurrent(coordinate);
      if (decision.status !== "available") {
        this.database.exec("COMMIT;");
        return decision;
      }
      const count = sqliteRow(
        this.database.prepare("SELECT COUNT(*) AS count FROM organization_rollback_replay").get(),
      )?.count;
      if (typeof count !== "number" || !Number.isSafeInteger(count)) {
        throw new OrganizationDeploymentSQLiteError("integrity_failed", "Invalid replay count.");
      }
      if (count >= this.maximumRecords) {
        throw new OrganizationDeploymentSQLiteError(
          "capacity_exceeded",
          "The organization rollback replay store reached its fixed capacity.",
        );
      }
      const reservationId = `orbres_${randomBytes(32).toString("base64url")}`;
      this.database
        .prepare(
          `INSERT INTO organization_rollback_replay
             (idempotency_key, delivery_hash, nonce, reservation_id, receipt_json,
              baseline_json, recovery_json)
           VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
        )
        .run(
          coordinate.idempotencyKey,
          coordinate.deliveryHash,
          coordinate.nonce,
          reservationId,
          JSON.stringify(coordinate.baseline),
        );
      this.database.exec("COMMIT;");
      return { status: "reserved", reservationId };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      if (error instanceof OrganizationDeploymentSQLiteError) throw error;
      throw new OrganizationDeploymentSQLiteError("write_failed", "Reservation failed.", {
        cause: error,
      });
    }
  }

  async complete(input: {
    reservationId: string;
    receipt: OrganizationNodeRollbackDeliveryReceipt;
  }): Promise<void> {
    this.assertOpen();
    assertOrganizationNodeRollbackDeliveryReceipt(input.receipt);
    const result = this.database
      .prepare(
        `UPDATE organization_rollback_replay SET receipt_json = ?
         WHERE reservation_id = ? AND receipt_json IS NULL
           AND delivery_hash = ? AND idempotency_key = ?`,
      )
      .run(
        JSON.stringify(input.receipt),
        input.reservationId,
        input.receipt.deliveryHash,
        input.receipt.idempotencyKey,
      );
    if (result.changes !== 1) {
      throw new OrganizationDeploymentSQLiteError(
        "write_failed",
        "The rollback reservation and receipt do not match.",
      );
    }
  }

  async inspectRecovery(
    coordinate: Parameters<OrganizationNodeRollbackDeliveryReplayStore["inspect"]>[0],
  ): Promise<OrganizationNodeRollbackRecoveryStateDecision> {
    this.assertOpen();
    assertReplayCoordinate(coordinate);
    const candidate = sqliteRow(
      this.database
        .prepare(`${SELECT_ROW} WHERE idempotency_key = ?`)
        .get(coordinate.idempotencyKey),
    );
    if (candidate === undefined) {
      const decision = this.inspectCurrent(coordinate);
      return decision.status === "in_progress" ? { status: "baseline_unavailable" } : decision;
    }
    const row = decodeRow(candidate);
    if (row.deliveryHash !== coordinate.deliveryHash || row.nonce !== coordinate.nonce) {
      return { status: "idempotency_conflict" };
    }
    if (row.receipt !== null) return { status: "duplicate", receipt: row.receipt };
    return {
      status: "recoverable",
      reservationId: row.reservationId,
      baseline: row.baseline,
      receipt: row.recovery,
    };
  }

  async recordRecovery(input: {
    reservationId: string;
    receipt: OrganizationNodeRollbackRecoveryReceipt;
  }): Promise<OrganizationNodeRollbackRecoveryReceipt> {
    this.assertOpen();
    assertOrganizationNodeRollbackRecoveryReceipt(input.receipt);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const candidate = sqliteRow(
        this.database.prepare(`${SELECT_ROW} WHERE reservation_id = ?`).get(input.reservationId),
      );
      if (candidate === undefined) {
        throw new OrganizationDeploymentSQLiteError("write_failed", "Reservation is missing.");
      }
      const row = decodeRow(candidate);
      if (
        row.receipt !== null ||
        row.deliveryHash !== input.receipt.deliveryHash ||
        row.idempotencyKey !== input.receipt.idempotencyKey
      ) {
        throw new OrganizationDeploymentSQLiteError(
          "write_failed",
          "The recovery receipt does not match the unresolved reservation.",
        );
      }
      if (row.recovery !== null && row.recovery.classification !== "unknown") {
        this.database.exec("COMMIT;");
        return row.recovery;
      }
      const result = this.database
        .prepare(
          `UPDATE organization_rollback_replay SET recovery_json = ?
           WHERE reservation_id = ? AND receipt_json IS NULL`,
        )
        .run(JSON.stringify(input.receipt), input.reservationId);
      if (result.changes !== 1) {
        throw new OrganizationDeploymentSQLiteError("write_failed", "Recovery write failed.");
      }
      this.database.exec("COMMIT;");
      return structuredClone(input.receipt);
    } catch (error) {
      this.database.exec("ROLLBACK;");
      if (error instanceof OrganizationDeploymentSQLiteError) throw error;
      throw new OrganizationDeploymentSQLiteError("write_failed", "Recovery write failed.", {
        cause: error,
      });
    }
  }

  checkIntegrity(): void {
    this.assertOpen();
    if (sqliteRow(this.database.prepare("PRAGMA quick_check;").get())?.quick_check !== "ok") {
      throw new OrganizationDeploymentSQLiteError("integrity_failed", "Integrity check failed.");
    }
    const rows = sqliteRows(this.database.prepare(SELECT_ROW).all());
    if (rows.length > this.maximumRecords) {
      throw new OrganizationDeploymentSQLiteError(
        "capacity_exceeded",
        "The organization rollback replay store exceeds its fixed capacity.",
      );
    }
    for (const row of rows) decodeRow(row);
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
