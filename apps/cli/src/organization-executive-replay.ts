import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import type {
  OrganizationExecutiveEffectReceipt,
  OrganizationExecutiveEffectReplayPort,
} from "@lervo/application-contract";
import { prepareOwnerOnlyDatabasePath } from "@lervo/runtime-security";

interface ReplayRow {
  request_id: string;
  effect_hash: string;
  status: "reserved" | "completed" | "unknown" | "rejected";
  receipt_json: string | null;
}

export class SQLiteOrganizationExecutiveEffectReplay implements OrganizationExecutiveEffectReplayPort {
  private constructor(private readonly database: DatabaseSync) {}

  static async open(path: string): Promise<SQLiteOrganizationExecutiveEffectReplay> {
    const database = openSqliteDatabase(await prepareOwnerOnlyDatabasePath(path), {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS organization_executive_effect_replay (
        effect_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        effect_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'unknown', 'rejected')),
        attempted_at TEXT NOT NULL,
        receipt_json TEXT
      ) STRICT;
    `);
    const quickCheck = database.prepare("PRAGMA quick_check;").get() as
      { quick_check?: unknown } | undefined;
    if (quickCheck?.quick_check !== "ok") {
      database.close();
      throw new Error("The organization executive replay database failed its integrity check.");
    }
    return new SQLiteOrganizationExecutiveEffectReplay(database);
  }

  async begin(input: {
    effectId: string;
    requestId: string;
    effectHash: string;
    attemptedAt: string;
  }) {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.row(input.effectId);
      if (current === null) {
        const count = Number(
          (
            this.database
              .prepare("SELECT COUNT(*) AS count FROM organization_executive_effect_replay")
              .get() as { count?: unknown } | undefined
          )?.count,
        );
        if (!Number.isSafeInteger(count) || count >= 10_000) {
          throw new Error("The organization executive effect replay capacity was reached.");
        }
        this.database
          .prepare(
            `INSERT INTO organization_executive_effect_replay
             (effect_id, request_id, effect_hash, status, attempted_at, receipt_json)
             VALUES (?, ?, ?, 'reserved', ?, NULL)`,
          )
          .run(input.effectId, input.requestId, input.effectHash, input.attemptedAt);
        this.database.exec("COMMIT;");
        return { status: "reserved" as const };
      }
      this.database.exec("COMMIT;");
      if (current.request_id !== input.requestId || current.effect_hash !== input.effectHash) {
        return { status: "conflict" as const };
      }
      if (current.status === "reserved" || current.status === "unknown") {
        return { status: "unknown" as const };
      }
      if (current.status === "rejected") return { status: "rejected" as const };
      if (current.receipt_json === null)
        throw new Error("The completed effect receipt is missing.");
      return {
        status: "completed" as const,
        receipt: JSON.parse(current.receipt_json) as OrganizationExecutiveEffectReceipt,
      };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch {
        // The transaction may already be committed.
      }
      throw error;
    }
  }

  async complete(receipt: OrganizationExecutiveEffectReceipt): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE organization_executive_effect_replay SET status = 'completed', receipt_json = ?
         WHERE effect_id = ? AND request_id = ? AND effect_hash = ? AND status = 'reserved'`,
      )
      .run(JSON.stringify(receipt), receipt.effectId, receipt.requestId, receipt.effectHash);
    if (result.changes !== 1)
      throw new Error("The executive effect completion coordinate changed.");
  }

  async markUnknown(input: {
    effectId: string;
    requestId: string;
    effectHash: string;
  }): Promise<void> {
    this.mark(input, "unknown");
  }

  async markRejected(input: {
    effectId: string;
    requestId: string;
    effectHash: string;
  }): Promise<void> {
    this.mark(input, "rejected");
  }

  close(): void {
    this.database.close();
  }

  private mark(
    input: { effectId: string; requestId: string; effectHash: string },
    status: "unknown" | "rejected",
  ): void {
    const result = this.database
      .prepare(
        `UPDATE organization_executive_effect_replay SET status = ?
         WHERE effect_id = ? AND request_id = ? AND effect_hash = ? AND status = 'reserved'`,
      )
      .run(status, input.effectId, input.requestId, input.effectHash);
    if (result.changes !== 1) throw new Error("The executive effect terminal coordinate changed.");
  }

  private row(effectId: string): ReplayRow | null {
    return (
      (this.database
        .prepare(
          `SELECT request_id, effect_hash, status, receipt_json
           FROM organization_executive_effect_replay WHERE effect_id = ?`,
        )
        .get(effectId) as ReplayRow | undefined) ?? null
    );
  }
}
