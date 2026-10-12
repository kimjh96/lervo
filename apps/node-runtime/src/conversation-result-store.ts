import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import { canonicalJson } from "@lervo/event-contract";
import { validateSchema } from "@lervo/schemas";

import {
  assertConversationResultOrigin,
  assertConversationResultTerminal,
  parseResultJson,
  resultTime,
  sameConversationResultTerminal,
} from "./conversation-result-store-codec.js";
import type {
  ConversationResultLease,
  ConversationResultOrigin,
  ConversationResultStore,
  ConversationResultTerminal,
} from "./conversation-result-types.js";
import { NodeRuntimeError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

interface ResultRow {
  delivery_id: string;
  origin_json: string;
  terminal_json: string | null;
  candidate_json: string | null;
  outbound_json: string | null;
  status: "awaiting" | "ready" | "leased" | "delivered";
  attempt_count: number;
  lease_id: string | null;
  lease_expires_at_ms: number | null;
}

async function secureDatabasePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe database path");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export class SQLiteConversationResultStore implements ConversationResultStore {
  private closed = false;

  private constructor(
    private readonly database: DatabaseSync,
    private readonly maxRecords: number,
  ) {}

  static async open(path: string, maxRecords = 1_024): Promise<SQLiteConversationResultStore> {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
      throw new NodeRuntimeError("startup_failed", "Conversation result capacity is invalid.");
    }
    const absolute = await secureDatabasePath(path);
    const database = openSqliteDatabase(absolute, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS conversation_execution_results (
          delivery_id TEXT PRIMARY KEY,
          command_id TEXT NOT NULL UNIQUE,
          origin_json TEXT NOT NULL,
          terminal_json TEXT,
          candidate_json TEXT,
          outbound_json TEXT,
          status TEXT NOT NULL CHECK (status IN ('awaiting', 'ready', 'leased', 'delivered')),
          available_at_ms INTEGER NOT NULL CHECK (available_at_ms >= 0),
          attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
          lease_id TEXT,
          lease_owner TEXT,
          lease_expires_at_ms INTEGER,
          last_failure_code TEXT,
          last_failed_at_ms INTEGER,
          delivered_at_ms INTEGER,
          CHECK ((status = 'awaiting' AND terminal_json IS NULL)
            OR (status != 'awaiting' AND terminal_json IS NOT NULL)),
          CHECK ((candidate_json IS NULL AND outbound_json IS NULL)
            OR (candidate_json IS NOT NULL AND outbound_json IS NOT NULL)),
          CHECK ((status = 'leased' AND lease_id IS NOT NULL AND lease_owner IS NOT NULL
              AND lease_expires_at_ms IS NOT NULL)
            OR (status != 'leased' AND lease_id IS NULL AND lease_owner IS NULL
              AND lease_expires_at_ms IS NULL)),
          CHECK ((status = 'delivered' AND delivered_at_ms IS NOT NULL)
            OR (status != 'delivered' AND delivered_at_ms IS NULL))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS conversation_execution_results_ready
          ON conversation_execution_results(status, available_at_ms, delivery_id);
        CREATE TRIGGER IF NOT EXISTS conversation_execution_results_identity_immutable
          BEFORE UPDATE ON conversation_execution_results
          WHEN OLD.delivery_id != NEW.delivery_id OR OLD.command_id != NEW.command_id
            OR OLD.origin_json != NEW.origin_json OR OLD.status = 'delivered'
          BEGIN SELECT RAISE(ABORT, 'conversation result identity is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS conversation_execution_results_no_delete
          BEFORE DELETE ON conversation_execution_results
          BEGIN SELECT RAISE(ABORT, 'conversation result cannot be deleted'); END;
      `);
      await chmod(absolute, 0o600);
      if (sqliteRow(database.prepare("PRAGMA quick_check;").get())?.quick_check !== "ok") {
        throw new Error("quick check failed");
      }
      return new SQLiteConversationResultStore(database, maxRecords);
    } catch (error) {
      database.close();
      throw new NodeRuntimeError("startup_failed", "Could not open conversation result state.", {
        cause: error,
      });
    }
  }

  async register(origin: ConversationResultOrigin): Promise<"created" | "duplicate"> {
    this.assertOpen();
    assertConversationResultOrigin(origin);
    const serialized = canonicalJson(origin);
    const existing = this.database
      .prepare("SELECT origin_json FROM conversation_execution_results WHERE delivery_id = ?")
      .get(origin.deliveryId) as { origin_json: string } | undefined;
    if (existing !== undefined) {
      if (existing.origin_json !== serialized) {
        throw new NodeRuntimeError("startup_failed", "Conversation result origin conflicts.");
      }
      return "duplicate";
    }
    const count = sqliteRow(
      this.database.prepare("SELECT COUNT(*) AS count FROM conversation_execution_results").get(),
    )?.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count >= this.maxRecords) {
      throw new NodeRuntimeError("startup_failed", "Conversation result capacity was exceeded.");
    }
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO conversation_execution_results (
          delivery_id, command_id, origin_json, terminal_json, candidate_json, outbound_json,
          status, available_at_ms, attempt_count, lease_id, lease_owner, lease_expires_at_ms,
          last_failure_code, last_failed_at_ms, delivered_at_ms
        ) VALUES (?, ?, ?, NULL, NULL, NULL, 'awaiting', ?, 0, NULL, NULL, NULL, NULL, NULL, NULL)`,
      )
      .run(
        origin.deliveryId,
        origin.commandId,
        serialized,
        resultTime(origin.queuedAt, "queuedAt"),
      );
    if (result.changes !== 1) {
      throw new NodeRuntimeError("startup_failed", "Conversation result origin was not saved.");
    }
    return "created";
  }

  async observeTerminal(
    input: Parameters<ConversationResultStore["observeTerminal"]>[0],
  ): Promise<"ready" | "duplicate" | "ignored"> {
    this.assertOpen();
    const { lease, terminal } = input;
    const acknowledgement = terminal.acknowledgement;
    assertConversationResultTerminal(terminal);
    if (
      !validateSchema("remoteCommandLease", lease).valid ||
      lease.deliveryId !== acknowledgement.deliveryId ||
      lease.leaseId !== acknowledgement.leaseId ||
      lease.envelope.command.commandId !== acknowledgement.commandId
    ) {
      throw new NodeRuntimeError("startup_failed", "Conversation result lease is invalid.");
    }
    const row = this.database
      .prepare("SELECT * FROM conversation_execution_results WHERE delivery_id = ?")
      .get(acknowledgement.deliveryId) as ResultRow | undefined;
    if (row === undefined) return "ignored";
    const origin = parseResultJson<ConversationResultOrigin>(
      row.origin_json,
      "Conversation result origin",
    );
    const command = lease.envelope.command;
    const action = command.action;
    const continuation = action.continuation;
    if (
      origin.commandId !== acknowledgement.commandId ||
      lease.deliveryId !== origin.deliveryId ||
      command.commandId !== origin.commandId ||
      command.target.projectId !== origin.target.projectId ||
      action.roleId !== origin.roleId ||
      action.provider !== origin.provider ||
      continuation?.workstreamId !== origin.workstreamId ||
      continuation.revision !== origin.workstreamRevision ||
      continuation.snapshotContentHash !== origin.workstreamSnapshotContentHash ||
      continuation.assignmentId !== origin.assignmentId ||
      continuation.agentId !== origin.agentId
    ) {
      throw new NodeRuntimeError("startup_failed", "Conversation result command conflicts.");
    }
    if (row.terminal_json !== null) {
      const current = parseResultJson<ConversationResultTerminal>(
        row.terminal_json,
        "Conversation result terminal",
      );
      if (!sameConversationResultTerminal(current, terminal)) {
        throw new NodeRuntimeError("startup_failed", "Conversation result terminal conflicts.");
      }
      return "duplicate";
    }
    const serialized = canonicalJson(terminal);
    const result = this.database
      .prepare(
        `UPDATE conversation_execution_results
         SET terminal_json = ?, status = 'ready', available_at_ms = ?
         WHERE delivery_id = ? AND status = 'awaiting' AND terminal_json IS NULL`,
      )
      .run(serialized, resultTime(terminal.observedAt, "observedAt"), origin.deliveryId);
    if (result.changes !== 1) {
      throw new NodeRuntimeError("startup_failed", "Conversation result terminal was not saved.");
    }
    return "ready";
  }

  async claim(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<ConversationResultLease | null> {
    this.assertOpen();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.workerId) ||
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 1_000 ||
      input.leaseDurationMs > 300_000
    ) {
      throw new NodeRuntimeError("startup_failed", "Conversation result lease is invalid.");
    }
    const claimedAt = resultTime(input.claimedAt, "claimedAt");
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.database
        .prepare(
          `SELECT * FROM conversation_execution_results
           WHERE (status = 'ready' AND available_at_ms <= ?)
             OR (status = 'leased' AND lease_expires_at_ms <= ?)
           ORDER BY available_at_ms, delivery_id LIMIT 1`,
        )
        .get(claimedAt, claimedAt) as ResultRow | undefined;
      if (row === undefined) {
        this.database.exec("COMMIT;");
        return null;
      }
      const leaseId = `crl_${randomBytes(24).toString("base64url")}`;
      const updated = this.database
        .prepare(
          `UPDATE conversation_execution_results SET status = 'leased', attempt_count = attempt_count + 1,
             lease_id = ?, lease_owner = ?, lease_expires_at_ms = ?
           WHERE delivery_id = ? AND status != 'delivered'`,
        )
        .run(leaseId, input.workerId, claimedAt + input.leaseDurationMs, row.delivery_id);
      if (updated.changes !== 1) throw new Error("lease acquisition failed");
      this.database.exec("COMMIT;");
      return this.decodeLease({ ...row, lease_id: leaseId, attempt_count: row.attempt_count + 1 });
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw new NodeRuntimeError("startup_failed", "Conversation result claim failed.", {
        cause: error,
      });
    }
  }

  async prepare(input: Parameters<ConversationResultStore["prepare"]>[0]): Promise<void> {
    this.assertOpen();
    const result = this.database
      .prepare(
        `UPDATE conversation_execution_results SET candidate_json = ?, outbound_json = ?
         WHERE delivery_id = ? AND status = 'leased' AND lease_id = ?
           AND candidate_json IS NULL AND outbound_json IS NULL`,
      )
      .run(
        canonicalJson(input.candidate),
        canonicalJson(input.outbound),
        input.deliveryId,
        input.leaseId,
      );
    if (result.changes !== 1) {
      throw new NodeRuntimeError(
        "startup_failed",
        "Conversation result publication was not saved.",
      );
    }
  }

  async acknowledge(input: Parameters<ConversationResultStore["acknowledge"]>[0]): Promise<void> {
    this.assertOpen();
    const result = this.database
      .prepare(
        `UPDATE conversation_execution_results SET status = 'delivered', delivered_at_ms = ?,
           lease_id = NULL, lease_owner = NULL, lease_expires_at_ms = NULL
         WHERE delivery_id = ? AND status = 'leased' AND lease_id = ?
           AND candidate_json IS NOT NULL AND outbound_json IS NOT NULL`,
      )
      .run(resultTime(input.deliveredAt, "deliveredAt"), input.deliveryId, input.leaseId);
    if (result.changes !== 1) {
      throw new NodeRuntimeError("startup_failed", "Conversation result receipt was not saved.");
    }
  }

  async reschedule(input: Parameters<ConversationResultStore["reschedule"]>[0]): Promise<void> {
    this.assertOpen();
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(input.failureCode)) {
      throw new NodeRuntimeError("startup_failed", "Conversation result failure code is invalid.");
    }
    const failedAt = resultTime(input.failedAt, "failedAt");
    const availableAt = resultTime(input.availableAt, "availableAt");
    if (availableAt < failedAt) {
      throw new NodeRuntimeError("startup_failed", "Conversation result retry time is invalid.");
    }
    const result = this.database
      .prepare(
        `UPDATE conversation_execution_results SET status = 'ready', available_at_ms = ?,
           lease_id = NULL, lease_owner = NULL, lease_expires_at_ms = NULL,
           last_failure_code = ?, last_failed_at_ms = ?
         WHERE delivery_id = ? AND status = 'leased' AND lease_id = ?`,
      )
      .run(availableAt, input.failureCode, failedAt, input.deliveryId, input.leaseId);
    if (result.changes !== 1) {
      throw new NodeRuntimeError("startup_failed", "Conversation result retry was not saved.");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private decodeLease(row: ResultRow): ConversationResultLease {
    if (row.terminal_json === null || row.lease_id === null) {
      throw new NodeRuntimeError("startup_failed", "Conversation result lease is corrupted.");
    }
    return {
      leaseId: row.lease_id,
      attemptCount: row.attempt_count,
      origin: parseResultJson(row.origin_json, "Conversation result origin"),
      terminal: parseResultJson(row.terminal_json, "Conversation result terminal"),
      candidate:
        row.candidate_json === null
          ? null
          : parseResultJson(row.candidate_json, "Conversation result candidate"),
      outbound:
        row.outbound_json === null
          ? null
          : parseResultJson(row.outbound_json, "Conversation result outbound"),
    };
  }

  private assertOpen(): void {
    if (this.closed)
      throw new NodeRuntimeError("startup_failed", "Conversation result store closed.");
  }
}
