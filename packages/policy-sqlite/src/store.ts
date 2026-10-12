import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import {
  type PolicyApprovalState,
  type PolicyStateStore,
  type VerifiedPolicyBundle,
} from "@lervo/policy";
import {
  assertPolicyApproval,
  assertPolicyApprovalRevocation,
  assertSignedPolicySnapshot,
  calculatePolicySnapshotHash,
} from "@lervo/policy-contract";
import {
  type PolicyApproval,
  type RemoteCommandTarget,
  type SignedPolicySnapshot,
} from "@lervo/schemas";

import { decodeApprovalRow, decodeRevocationRow, decodeSnapshotRow } from "./codec.js";
import {
  configurePolicyDatabase,
  ensurePolicyDatabasePath,
  migratePolicyDatabase,
} from "./database.js";
import { PolicySQLiteError } from "./errors.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

const SNAPSHOT_COLUMNS = `snapshot_id, sequence, previous_snapshot_id, snapshot_hash,
  issued_at_ms, expires_at_ms, envelope_json`;
const APPROVAL_COLUMNS = `approval_id, snapshot_id, command_id, command_hash,
  command_signer_key_id, capability, granted_at_ms, expires_at_ms, envelope_json`;
const REVOCATION_COLUMNS = `revocation_id, approval_id, revoked_at_ms, envelope_json`;

export class SQLitePolicyStateStore implements PolicyStateStore {
  readonly path: string;
  private closed = false;

  private constructor(
    path: string,
    private readonly database: DatabaseSync,
    private readonly maxSnapshots: number,
    private readonly maxApprovals: number,
  ) {
    this.path = path;
  }

  static async open(options: {
    path: string;
    target: RemoteCommandTarget;
    maxSnapshots?: number;
    maxApprovals?: number;
  }): Promise<SQLitePolicyStateStore> {
    const maxSnapshots = options.maxSnapshots ?? 1_000;
    const maxApprovals = options.maxApprovals ?? 100_000;
    if (
      !Number.isSafeInteger(maxSnapshots) ||
      maxSnapshots < 1 ||
      maxSnapshots > 100_000 ||
      !Number.isSafeInteger(maxApprovals) ||
      maxApprovals < 1 ||
      maxApprovals > 1_000_000
    )
      throw new PolicySQLiteError(
        "integrity_failed",
        "The policy SQLite capacity settings are invalid.",
      );
    const path = await ensurePolicyDatabasePath(options.path);
    const database = openSqliteDatabase(path, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configurePolicyDatabase(database);
      migratePolicyDatabase(database);
      const store = new SQLitePolicyStateStore(path, database, maxSnapshots, maxApprovals);
      store.bindTarget(options.target);
      store.checkStructure();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new PolicySQLiteError("closed", "The policy store is closed.");
  }

  private bindTarget(target: RemoteCommandTarget): void {
    if (
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(target.projectId) ||
      !/^sha256:[a-f0-9]{64}$/.test(target.projectIdentityHash)
    )
      throw new PolicySQLiteError(
        "integrity_failed",
        "The policy store project target is invalid.",
      );
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const projectId = sqliteRow(
        this.database.prepare("SELECT value FROM policy_meta WHERE key = 'project_id'").get(),
      )?.value;
      const identityHash = sqliteRow(
        this.database
          .prepare("SELECT value FROM policy_meta WHERE key = 'project_identity_hash'")
          .get(),
      )?.value;
      if (projectId === undefined && identityHash === undefined) {
        const insert = this.database.prepare("INSERT INTO policy_meta (key, value) VALUES (?, ?)");
        insert.run("project_id", target.projectId);
        insert.run("project_identity_hash", target.projectIdentityHash);
      } else if (projectId !== target.projectId || identityHash !== target.projectIdentityHash) {
        throw new PolicySQLiteError(
          "integrity_failed",
          "The policy database is bound to a different project.",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async getCurrentSnapshot(): Promise<SignedPolicySnapshot | null> {
    this.assertOpen();
    const row = sqliteRow(
      this.database
        .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM policy_snapshots ORDER BY sequence DESC LIMIT 1`)
        .get(),
    );
    return row === undefined ? null : decodeSnapshotRow(row);
  }

  async getApproval(approvalId: string): Promise<PolicyApprovalState | null> {
    this.assertOpen();
    const row = sqliteRow(
      this.database
        .prepare(`SELECT ${APPROVAL_COLUMNS} FROM policy_approvals WHERE approval_id = ?`)
        .get(approvalId),
    );
    if (row === undefined) return null;
    const revocation = sqliteRow(
      this.database
        .prepare(`SELECT ${REVOCATION_COLUMNS} FROM policy_revocations WHERE approval_id = ?`)
        .get(approvalId),
    );
    return {
      approval: decodeApprovalRow(row),
      revocation: revocation === undefined ? null : decodeRevocationRow(revocation),
    };
  }

  async findApprovals(input: {
    snapshotId: string;
    commandId: string;
    commandSignerKeyId: string;
    capability: PolicyApproval["capability"];
  }): Promise<PolicyApprovalState[]> {
    this.assertOpen();
    const rows = sqliteRows(
      this.database
        .prepare(
          `
      SELECT ${APPROVAL_COLUMNS} FROM policy_approvals
      WHERE snapshot_id = ? AND command_id = ?
        AND command_signer_key_id = ? AND capability = ?
      ORDER BY granted_at_ms DESC, approval_id ASC LIMIT 64
    `,
        )
        .all(input.snapshotId, input.commandId, input.commandSignerKeyId, input.capability),
    );
    const result: PolicyApprovalState[] = [];
    for (const row of rows) {
      const approval = decodeApprovalRow(row);
      const revocation = sqliteRow(
        this.database
          .prepare(`SELECT ${REVOCATION_COLUMNS} FROM policy_revocations WHERE approval_id = ?`)
          .get(approval.approval.approvalId),
      );
      result.push({
        approval,
        revocation: revocation === undefined ? null : decodeRevocationRow(revocation),
      });
    }
    return result;
  }

  async applyVerifiedBundle(bundle: VerifiedPolicyBundle) {
    this.assertOpen();
    assertSignedPolicySnapshot(bundle.snapshot);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const currentRow = sqliteRow(
        this.database
          .prepare(
            `SELECT ${SNAPSHOT_COLUMNS} FROM policy_snapshots ORDER BY sequence DESC LIMIT 1`,
          )
          .get(),
      );
      const current = currentRow === undefined ? null : decodeSnapshotRow(currentRow);
      const snapshot = bundle.snapshot.snapshot;
      const duplicateSnapshot = current?.snapshot.snapshotId === snapshot.snapshotId;
      if (
        current !== null &&
        !duplicateSnapshot &&
        (snapshot.sequence !== current.snapshot.sequence + 1 ||
          snapshot.previousSnapshotId !== current.snapshot.snapshotId)
      )
        throw new PolicySQLiteError(
          "stale_policy",
          "The policy snapshot is not the next revision in the current continuous history.",
        );
      if (!duplicateSnapshot) {
        const count = sqliteRow(
          this.database.prepare("SELECT COUNT(*) AS count FROM policy_snapshots").get(),
        )?.count;
        if (typeof count !== "number" || count >= this.maxSnapshots) {
          throw new PolicySQLiteError(
            "capacity_exceeded",
            "The policy snapshot capacity has been exceeded.",
          );
        }
        this.database
          .prepare(
            `INSERT INTO policy_snapshots (${SNAPSHOT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            snapshot.snapshotId,
            snapshot.sequence,
            snapshot.previousSnapshotId,
            calculatePolicySnapshotHash(snapshot),
            Date.parse(snapshot.issuedAt),
            Date.parse(snapshot.expiresAt),
            JSON.stringify(bundle.snapshot),
          );
      } else if (JSON.stringify(current) !== JSON.stringify(bundle.snapshot)) {
        throw new PolicySQLiteError(
          "integrity_failed",
          "Sources with the same policy snapshot ID differ.",
        );
      }

      const approvalCount = sqliteRow(
        this.database.prepare("SELECT COUNT(*) AS count FROM policy_approvals").get(),
      )?.count;
      if (typeof approvalCount !== "number") {
        throw new PolicySQLiteError(
          "capacity_exceeded",
          "The policy approval capacity has been exceeded.",
        );
      }
      let currentApprovalCount = approvalCount;
      let insertedApprovals = 0;
      for (const envelope of bundle.approvals) {
        const approval = envelope.approval;
        assertPolicyApproval({ approval, snapshot });
        const existing = sqliteRow(
          this.database
            .prepare(`SELECT ${APPROVAL_COLUMNS} FROM policy_approvals WHERE approval_id = ?`)
            .get(approval.approvalId),
        );
        if (existing !== undefined) {
          if (JSON.stringify(decodeApprovalRow(existing)) !== JSON.stringify(envelope)) {
            throw new PolicySQLiteError(
              "integrity_failed",
              "Sources with the same policy approval ID differ.",
            );
          }
          continue;
        }
        if (currentApprovalCount >= this.maxApprovals) {
          throw new PolicySQLiteError(
            "capacity_exceeded",
            "The policy approval capacity has been exceeded.",
          );
        }
        this.database
          .prepare(
            `INSERT INTO policy_approvals (${APPROVAL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            approval.approvalId,
            approval.snapshotId,
            approval.commandId,
            approval.commandHash,
            approval.commandSignerKeyId,
            approval.capability,
            Date.parse(approval.grantedAt),
            Date.parse(approval.expiresAt),
            JSON.stringify(envelope),
          );
        insertedApprovals += 1;
        currentApprovalCount += 1;
      }
      let insertedRevocations = 0;
      for (const envelope of bundle.revocations) {
        const state = this.getApprovalWithinTransaction(envelope.revocation.approvalId);
        if (state === null)
          throw new PolicySQLiteError(
            "integrity_failed",
            "The policy revocation's source approval is missing.",
          );
        assertPolicyApprovalRevocation({
          revocation: envelope.revocation,
          approval: state.approval.approval,
        });
        if (state.revocation !== null) {
          if (JSON.stringify(state.revocation) !== JSON.stringify(envelope)) {
            throw new PolicySQLiteError(
              "integrity_failed",
              "The policy approval already has a different revocation.",
            );
          }
          continue;
        }
        this.database
          .prepare(`INSERT INTO policy_revocations (${REVOCATION_COLUMNS}) VALUES (?, ?, ?, ?)`)
          .run(
            envelope.revocation.revocationId,
            envelope.revocation.approvalId,
            Date.parse(envelope.revocation.revokedAt),
            JSON.stringify(envelope),
          );
        insertedRevocations += 1;
      }
      this.database.exec("COMMIT;");
      return {
        status:
          !duplicateSnapshot || insertedApprovals > 0 || insertedRevocations > 0
            ? ("applied" as const)
            : ("duplicate" as const),
        snapshotId: snapshot.snapshotId,
        approvalCount: insertedApprovals,
        revocationCount: insertedRevocations,
      };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new PolicySQLiteError(
          "write_failed",
          "Saving the policy bundle and rolling back both failed.",
          {
            cause: new AggregateError([error, rollbackError]),
          },
        );
      }
      if (error instanceof PolicySQLiteError) throw error;
      throw new PolicySQLiteError("write_failed", "The policy bundle could not be saved.", {
        cause: error,
      });
    }
  }

  private getApprovalWithinTransaction(approvalId: string): PolicyApprovalState | null {
    const row = sqliteRow(
      this.database
        .prepare(`SELECT ${APPROVAL_COLUMNS} FROM policy_approvals WHERE approval_id = ?`)
        .get(approvalId),
    );
    if (row === undefined) return null;
    const revocation = sqliteRow(
      this.database
        .prepare(`SELECT ${REVOCATION_COLUMNS} FROM policy_revocations WHERE approval_id = ?`)
        .get(approvalId),
    );
    return {
      approval: decodeApprovalRow(row),
      revocation: revocation === undefined ? null : decodeRevocationRow(revocation),
    };
  }

  checkStructure(): void {
    this.assertOpen();
    if (sqliteRow(this.database.prepare("PRAGMA quick_check;").get())?.quick_check !== "ok") {
      throw new PolicySQLiteError("integrity_failed", "The policy SQLite quick_check failed.");
    }
    const required = new Set([
      "policy_snapshots_immutable",
      "policy_snapshots_no_delete",
      "policy_approvals_immutable",
      "policy_approvals_no_delete",
      "policy_revocations_immutable",
      "policy_revocations_no_delete",
    ]);
    for (const row of sqliteRows(
      this.database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger'").all(),
    )) {
      if (typeof row.name === "string") required.delete(row.name);
    }
    if (required.size !== 0)
      throw new PolicySQLiteError(
        "integrity_failed",
        "A policy SQLite immutability trigger is missing.",
      );
    const meta = sqliteRows(
      this.database.prepare("SELECT key, value FROM policy_meta ORDER BY key").all(),
    );
    if (
      meta.length !== 2 ||
      meta[0]?.key !== "project_id" ||
      meta[1]?.key !== "project_identity_hash"
    ) {
      throw new PolicySQLiteError(
        "integrity_failed",
        "The policy SQLite project metadata is invalid.",
      );
    }
    const snapshots = sqliteRow(
      this.database.prepare("SELECT COUNT(*) AS count FROM policy_snapshots").get(),
    )?.count;
    const approvals = sqliteRow(
      this.database.prepare("SELECT COUNT(*) AS count FROM policy_approvals").get(),
    )?.count;
    if (
      typeof snapshots !== "number" ||
      snapshots > this.maxSnapshots ||
      typeof approvals !== "number" ||
      approvals > this.maxApprovals
    ) {
      throw new PolicySQLiteError(
        "capacity_exceeded",
        "The policy SQLite capacity has been exceeded.",
      );
    }
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
