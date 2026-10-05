import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  assertOrganizationNodeRolloutDeliveryReceipt,
  assertOrganizationNodeRolloutRecoveryObservation,
  assertOrganizationNodeRolloutRecoveryReceipt,
  type OrganizationNodeRolloutDeliveryReplayDecision,
  type OrganizationNodeRolloutDeliveryReplayStore,
  type OrganizationNodeRolloutDeliveryReservationDecision,
  type OrganizationNodeRolloutRecoveryStateDecision,
} from "@lervo/organization-deployment-contract";
import type {
  OrganizationNodeRolloutDeliveryReceipt,
  OrganizationNodeRolloutRecoveryReceipt,
  OrganizationProjectTarget,
} from "@lervo/schemas";

import {
  configureOrganizationRolloutDatabase,
  ensureOrganizationRolloutDatabasePath,
  migrateOrganizationRolloutDatabase,
} from "./database.js";
import { OrganizationDeploymentSQLiteError } from "./errors.js";
import {
  assertReplayCoordinate,
  assertReplayStoreIntegrity,
  decodeDeliveryReceipt,
  decodeRecoveryBaseline,
  decodeRecoveryReceipt,
  decodeReplayRow,
  type ReplayCoordinate,
  type ReplayReservation,
} from "./replay-record.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

export class SQLiteOrganizationNodeRolloutReplayStore implements OrganizationNodeRolloutDeliveryReplayStore {
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
  }): Promise<SQLiteOrganizationNodeRolloutReplayStore> {
    const maximumRecords = input.maximumRecords ?? 1_024;
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 100_000) {
      throw new OrganizationDeploymentSQLiteError(
        "integrity_failed",
        "The organization rollout replay capacity is invalid.",
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
      const store = new SQLiteOrganizationNodeRolloutReplayStore(path, database, maximumRecords);
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
    if (
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.target.projectId) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.target.projectIdentityHash) ||
      !/^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.nodeId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(input.destinationId)
    ) {
      throw new OrganizationDeploymentSQLiteError(
        "integrity_failed",
        "The organization rollout replay target is invalid.",
      );
    }
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
          "The organization rollout replay database belongs to a different target.",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new OrganizationDeploymentSQLiteError(
        "closed",
        "The organization rollout replay store is closed.",
      );
    }
  }

  private inspectCurrent(
    coordinate: ReplayCoordinate,
  ): OrganizationNodeRolloutDeliveryReplayDecision {
    assertReplayCoordinate(coordinate);
    const row = sqliteRow(
      this.database
        .prepare(
          `SELECT idempotency_key, delivery_hash, nonce, reservation_id, receipt_json,
                baseline_json, recovery_json
         FROM organization_rollout_replay WHERE idempotency_key = ?`,
        )
        .get(coordinate.idempotencyKey),
    );
    if (row !== undefined) {
      const decoded = decodeReplayRow(row);
      if (decoded.delivery_hash !== coordinate.deliveryHash || decoded.nonce !== coordinate.nonce) {
        return { status: "idempotency_conflict" };
      }
      const receipt = decodeDeliveryReceipt(decoded);
      return receipt === null ? { status: "in_progress" } : { status: "duplicate", receipt };
    }
    const nonce = sqliteRow(
      this.database
        .prepare("SELECT idempotency_key FROM organization_rollout_replay WHERE nonce = ?")
        .get(coordinate.nonce),
    );
    return nonce === undefined ? { status: "available" } : { status: "nonce_replay" };
  }

  async inspect(
    coordinate: ReplayCoordinate,
  ): Promise<OrganizationNodeRolloutDeliveryReplayDecision> {
    this.assertOpen();
    return this.inspectCurrent(coordinate);
  }

  async reserve(
    coordinate: ReplayReservation,
  ): Promise<OrganizationNodeRolloutDeliveryReservationDecision> {
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
        this.database.prepare("SELECT COUNT(*) AS count FROM organization_rollout_replay").get(),
      )?.count;
      if (typeof count !== "number" || !Number.isSafeInteger(count)) {
        throw new OrganizationDeploymentSQLiteError(
          "integrity_failed",
          "The organization rollout replay count is invalid.",
        );
      }
      if (count >= this.maximumRecords) {
        throw new OrganizationDeploymentSQLiteError(
          "capacity_exceeded",
          "The organization rollout replay store reached its fixed capacity.",
        );
      }
      const reservationId = `orr_${randomBytes(32).toString("base64url")}`;
      this.database
        .prepare(
          `INSERT INTO organization_rollout_replay
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
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new OrganizationDeploymentSQLiteError(
          "write_failed",
          "Both organization rollout reservation and rollback failed.",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
      if (error instanceof OrganizationDeploymentSQLiteError) throw error;
      throw new OrganizationDeploymentSQLiteError(
        "write_failed",
        "The organization rollout replay reservation could not be saved.",
        { cause: error },
      );
    }
  }

  async inspectRecovery(
    coordinate: ReplayCoordinate,
  ): Promise<OrganizationNodeRolloutRecoveryStateDecision> {
    this.assertOpen();
    assertReplayCoordinate(coordinate);
    const candidate = sqliteRow(
      this.database
        .prepare(
          `SELECT idempotency_key, delivery_hash, nonce, reservation_id, receipt_json,
                baseline_json, recovery_json
         FROM organization_rollout_replay WHERE idempotency_key = ?`,
        )
        .get(coordinate.idempotencyKey),
    );
    if (candidate === undefined) {
      const replay = this.inspectCurrent(coordinate);
      return replay.status === "in_progress" ? { status: "baseline_unavailable" } : replay;
    }
    const row = decodeReplayRow(candidate);
    if (row.delivery_hash !== coordinate.deliveryHash || row.nonce !== coordinate.nonce) {
      return { status: "idempotency_conflict" };
    }
    const completed = decodeDeliveryReceipt(row);
    if (completed !== null) return { status: "duplicate", receipt: completed };
    const baseline = decodeRecoveryBaseline(row);
    if (baseline === null) return { status: "baseline_unavailable" };
    return {
      status: "recoverable",
      reservationId: row.reservation_id,
      baseline,
      receipt: decodeRecoveryReceipt(row),
    };
  }

  async recordRecovery(input: {
    reservationId: string;
    receipt: OrganizationNodeRolloutRecoveryReceipt;
  }): Promise<OrganizationNodeRolloutRecoveryReceipt> {
    this.assertOpen();
    assertOrganizationNodeRolloutRecoveryReceipt(input.receipt);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const candidate = sqliteRow(
        this.database
          .prepare(
            `SELECT idempotency_key, delivery_hash, nonce, reservation_id, receipt_json,
                  baseline_json, recovery_json
           FROM organization_rollout_replay WHERE reservation_id = ?`,
          )
          .get(input.reservationId),
      );
      if (candidate === undefined) {
        throw new OrganizationDeploymentSQLiteError(
          "write_failed",
          "The organization rollout recovery reservation does not exist.",
        );
      }
      const row = decodeReplayRow(candidate);
      if (
        row.receipt_json !== null ||
        row.delivery_hash !== input.receipt.deliveryHash ||
        row.idempotency_key !== input.receipt.idempotencyKey ||
        decodeRecoveryBaseline(row) === null
      ) {
        throw new OrganizationDeploymentSQLiteError(
          "write_failed",
          "The organization rollout recovery receipt does not match an unresolved reservation.",
        );
      }
      const previous = decodeRecoveryReceipt(row);
      if (previous !== null && previous.classification !== "unknown") {
        this.database.exec("COMMIT;");
        return previous;
      }
      const result = this.database
        .prepare(
          `UPDATE organization_rollout_replay SET recovery_json = ?
           WHERE reservation_id = ? AND receipt_json IS NULL`,
        )
        .run(JSON.stringify(input.receipt), input.reservationId);
      if (result.changes !== 1) {
        throw new OrganizationDeploymentSQLiteError(
          "write_failed",
          "The organization rollout recovery receipt could not advance the reservation.",
        );
      }
      this.database.exec("COMMIT;");
      return structuredClone(input.receipt);
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new OrganizationDeploymentSQLiteError(
          "write_failed",
          "Both organization rollout recovery persistence and rollback failed.",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
      if (error instanceof OrganizationDeploymentSQLiteError) throw error;
      throw new OrganizationDeploymentSQLiteError(
        "write_failed",
        "The organization rollout recovery receipt could not be saved.",
        { cause: error },
      );
    }
  }

  async complete(input: {
    reservationId: string;
    receipt: OrganizationNodeRolloutDeliveryReceipt;
  }): Promise<void> {
    this.assertOpen();
    assertOrganizationNodeRolloutDeliveryReceipt(input.receipt);
    try {
      const result = this.database
        .prepare(
          `UPDATE organization_rollout_replay SET receipt_json = ?
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
          "The organization rollout reservation and receipt do not match.",
        );
      }
    } catch (error) {
      if (error instanceof OrganizationDeploymentSQLiteError) throw error;
      throw new OrganizationDeploymentSQLiteError(
        "write_failed",
        "The organization rollout replay receipt could not be saved.",
        { cause: error },
      );
    }
  }

  checkIntegrity(): void {
    this.assertOpen();
    assertReplayStoreIntegrity(this.database, this.maximumRecords);
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
