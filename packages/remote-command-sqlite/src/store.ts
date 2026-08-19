import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  type RemoteCommandReplayCoordinate,
  type RemoteCommandReplayDecision,
  type RemoteCommandReplayStore,
  type RemoteCommandReservationDecision,
} from "@lervo/remote-command";
import { type RemoteCommandExecutionReceipt, type RemoteCommandTarget, validateSchema } from "@lervo/schemas";

import {
  configureRemoteCommandDatabase,
  ensureRemoteCommandDatabasePath,
  migrateRemoteCommandDatabase,
} from "./database.js";
import { RemoteCommandSQLiteError } from "./errors.js";
import {
  assertReplayCoordinate,
  decodeReplayReceipt,
  decodeReplayRow,
  REMOTE_COMMAND_HASH_PATTERN,
} from "./row-codec.js";

export class SQLiteRemoteCommandReplayStore implements RemoteCommandReplayStore {
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
    target: RemoteCommandTarget;
    maxRecords?: number;
  }): Promise<SQLiteRemoteCommandReplayStore> {
    const maxRecords = options.maxRecords ?? 1_024;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
      throw new RemoteCommandSQLiteError(
        "integrity_failed",
        "remote command replay maxRecords가 유효하지 않습니다.",
      );
    }
    const path = await ensureRemoteCommandDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureRemoteCommandDatabase(database);
      migrateRemoteCommandDatabase(database);
      const store = new SQLiteRemoteCommandReplayStore(path, database, maxRecords);
      store.bindTarget(options.target);
      store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private bindTarget(target: RemoteCommandTarget): void {
    if (
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(target.projectId) ||
      !REMOTE_COMMAND_HASH_PATTERN.test(target.projectIdentityHash)
    ) {
      throw new RemoteCommandSQLiteError(
        "integrity_failed",
        "remote command replay project target이 유효하지 않습니다.",
      );
    }
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const projectId = this.database.prepare(
        "SELECT value FROM remote_command_meta WHERE key = 'project_id'",
      ).get()?.value;
      const identityHash = this.database.prepare(
        "SELECT value FROM remote_command_meta WHERE key = 'project_identity_hash'",
      ).get()?.value;
      if (projectId === undefined && identityHash === undefined) {
        const insert = this.database.prepare(
          "INSERT INTO remote_command_meta (key, value) VALUES (?, ?)",
        );
        insert.run("project_id", target.projectId);
        insert.run("project_identity_hash", target.projectIdentityHash);
      } else if (
        projectId !== target.projectId || identityHash !== target.projectIdentityHash
      ) {
        throw new RemoteCommandSQLiteError(
          "integrity_failed",
          "remote command replay database가 다른 project에 고정되어 있습니다.",
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
      throw new RemoteCommandSQLiteError("closed", "닫힌 remote command replay store입니다.");
    }
  }

  private inspectCurrent(
    coordinate: RemoteCommandReplayCoordinate,
  ): RemoteCommandReplayDecision {
    assertReplayCoordinate(coordinate);
    const row = this.database.prepare(`
      SELECT idempotency_key, command_hash, nonce, reservation_id, receipt_json
      FROM remote_command_replay WHERE idempotency_key = ?
    `).get(coordinate.idempotencyKey);
    if (row !== undefined) {
      const decoded = decodeReplayRow(row);
      if (
        decoded.command_hash !== coordinate.commandHash ||
        decoded.nonce !== coordinate.nonce
      ) {
        return { status: "idempotency_conflict" };
      }
      const receipt = decodeReplayReceipt(decoded);
      return receipt === null
        ? { status: "in_progress" }
        : { status: "duplicate", receipt };
    }
    const nonce = this.database.prepare(`
      SELECT idempotency_key FROM remote_command_replay WHERE nonce = ?
    `).get(coordinate.nonce);
    if (nonce !== undefined) return { status: "nonce_replay" };
    return { status: "available" };
  }

  async inspect(coordinate: RemoteCommandReplayCoordinate): Promise<RemoteCommandReplayDecision> {
    this.assertOpen();
    return this.inspectCurrent(coordinate);
  }

  async reserve(
    coordinate: RemoteCommandReplayCoordinate,
  ): Promise<RemoteCommandReservationDecision> {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const decision = this.inspectCurrent(coordinate);
      if (decision.status !== "available") {
        this.database.exec("COMMIT;");
        return decision;
      }
      const count = this.database.prepare(
        "SELECT COUNT(*) AS count FROM remote_command_replay",
      ).get()?.count;
      if (typeof count !== "number" || !Number.isSafeInteger(count)) {
        throw new RemoteCommandSQLiteError("integrity_failed", "remote command replay count가 유효하지 않습니다.");
      }
      if (count >= this.maxRecords) {
        throw new RemoteCommandSQLiteError(
          "capacity_exceeded",
          "remote command replay capacity를 초과했습니다.",
        );
      }
      const reservationId = `rsv_${randomBytes(32).toString("base64url")}`;
      this.database.prepare(`
        INSERT INTO remote_command_replay (
          idempotency_key, command_hash, nonce, reservation_id, receipt_json
        ) VALUES (?, ?, ?, ?, NULL)
      `).run(
        coordinate.idempotencyKey,
        coordinate.commandHash,
        coordinate.nonce,
        reservationId,
      );
      this.database.exec("COMMIT;");
      return { status: "reserved", reservationId };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new RemoteCommandSQLiteError(
          "write_failed",
          "remote command replay reserve와 rollback이 실패했습니다.",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
      if (error instanceof RemoteCommandSQLiteError) throw error;
      throw new RemoteCommandSQLiteError(
        "write_failed",
        "remote command replay reservation을 저장하지 못했습니다.",
        { cause: error },
      );
    }
  }

  async complete(input: {
    reservationId: string;
    receipt: RemoteCommandExecutionReceipt;
  }): Promise<void> {
    this.assertOpen();
    if (!validateSchema("remoteCommandExecutionReceipt", input.receipt).valid) {
      throw new RemoteCommandSQLiteError("integrity_failed", "remote command receipt가 유효하지 않습니다.");
    }
    try {
      const result = this.database.prepare(`
        UPDATE remote_command_replay
        SET receipt_json = ?
        WHERE reservation_id = ? AND receipt_json IS NULL
          AND command_hash = ? AND idempotency_key = ?
      `).run(
        JSON.stringify(input.receipt),
        input.reservationId,
        input.receipt.commandHash,
        input.receipt.idempotencyKey,
      );
      if (result.changes !== 1) {
        throw new RemoteCommandSQLiteError(
          "write_failed",
          "remote command reservation과 receipt가 일치하지 않습니다.",
        );
      }
    } catch (error) {
      if (error instanceof RemoteCommandSQLiteError) throw error;
      throw new RemoteCommandSQLiteError(
        "write_failed",
        "remote command receipt를 저장하지 못했습니다.",
        { cause: error },
      );
    }
  }

  checkIntegrity(): void {
    this.assertOpen();
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new RemoteCommandSQLiteError("integrity_failed", "remote command SQLite quick_check가 실패했습니다.");
    }
    const requiredTriggers = new Set([
      "remote_command_replay_no_delete",
      "remote_command_replay_coordinate_immutable",
    ]);
    for (const row of this.database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'trigger'",
    ).all()) {
      if (typeof row.name === "string") requiredTriggers.delete(row.name);
    }
    if (requiredTriggers.size !== 0) {
      throw new RemoteCommandSQLiteError("integrity_failed", "remote command replay trigger가 누락되었습니다.");
    }
    const metadata = this.database.prepare(
      "SELECT key, value FROM remote_command_meta ORDER BY key ASC",
    ).all();
    if (
      metadata.length !== 2 ||
      metadata[0]?.key !== "project_id" || typeof metadata[0]?.value !== "string" ||
      metadata[1]?.key !== "project_identity_hash" ||
      typeof metadata[1]?.value !== "string"
    ) {
      throw new RemoteCommandSQLiteError("integrity_failed", "remote command replay project metadata가 유효하지 않습니다.");
    }
    const rows = this.database.prepare(`
      SELECT idempotency_key, command_hash, nonce, reservation_id, receipt_json
      FROM remote_command_replay
    `).all();
    if (rows.length > this.maxRecords) {
      throw new RemoteCommandSQLiteError("capacity_exceeded", "remote command replay capacity를 초과했습니다.");
    }
    for (const row of rows) decodeReplayReceipt(decodeReplayRow(row));
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
