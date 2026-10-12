import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type DatabaseSync } from "node:sqlite";

import { PolicySQLiteError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

export async function ensurePolicyDatabasePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new PolicySQLiteError(
        "integrity_failed",
        "The policy SQLite path must be a regular file.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export function configurePolicyDatabase(database: DatabaseSync): void {
  const defensive = database as DatabaseSync & { enableDefensive?: (active: boolean) => void };
  defensive.enableDefensive?.(true);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
  `);
}

export function migratePolicyDatabase(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const version = sqliteRow(database.prepare("PRAGMA user_version;").get())?.user_version;
    if (version !== 0 && version !== 1) {
      throw new PolicySQLiteError("integrity_failed", "The policy SQLite schema is unsupported.");
    }
    if (version === 0) {
      database.exec(`
        CREATE TABLE policy_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE policy_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          sequence INTEGER NOT NULL UNIQUE,
          previous_snapshot_id TEXT,
          snapshot_hash TEXT NOT NULL,
          issued_at_ms INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          envelope_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE policy_approvals (
          approval_id TEXT PRIMARY KEY,
          snapshot_id TEXT NOT NULL,
          command_id TEXT NOT NULL,
          command_hash TEXT NOT NULL,
          command_signer_key_id TEXT NOT NULL,
          capability TEXT NOT NULL,
          granted_at_ms INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          envelope_json TEXT NOT NULL,
          FOREIGN KEY (snapshot_id) REFERENCES policy_snapshots(snapshot_id)
        ) STRICT;
        CREATE INDEX policy_approvals_lookup ON policy_approvals (
          snapshot_id, command_id, command_signer_key_id, capability
        );
        CREATE TABLE policy_revocations (
          revocation_id TEXT PRIMARY KEY,
          approval_id TEXT NOT NULL UNIQUE,
          revoked_at_ms INTEGER NOT NULL,
          envelope_json TEXT NOT NULL,
          FOREIGN KEY (approval_id) REFERENCES policy_approvals(approval_id)
        ) STRICT;
        CREATE TRIGGER policy_snapshots_immutable
          BEFORE UPDATE ON policy_snapshots
          BEGIN SELECT RAISE(ABORT, 'policy snapshots are immutable'); END;
        CREATE TRIGGER policy_snapshots_no_delete
          BEFORE DELETE ON policy_snapshots
          BEGIN SELECT RAISE(ABORT, 'policy snapshots cannot be deleted'); END;
        CREATE TRIGGER policy_approvals_immutable
          BEFORE UPDATE ON policy_approvals
          BEGIN SELECT RAISE(ABORT, 'policy approvals are immutable'); END;
        CREATE TRIGGER policy_approvals_no_delete
          BEFORE DELETE ON policy_approvals
          BEGIN SELECT RAISE(ABORT, 'policy approvals cannot be deleted'); END;
        CREATE TRIGGER policy_revocations_immutable
          BEFORE UPDATE ON policy_revocations
          BEGIN SELECT RAISE(ABORT, 'policy revocations are immutable'); END;
        CREATE TRIGGER policy_revocations_no_delete
          BEFORE DELETE ON policy_revocations
          BEGIN SELECT RAISE(ABORT, 'policy revocations cannot be deleted'); END;
        PRAGMA user_version = 1;
      `);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
