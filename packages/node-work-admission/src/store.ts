import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  NodeWorkAdmissionError,
  type NodeWorkSession,
  type NodeWorkClaim,
  type NodeUpgradeFreeze,
  type NodeUpgradeFreezeResult,
} from "./contract.js";
import { openAdmissionDatabase } from "./database.js";
import { ProcessOwnership } from "./process-ownership.js";
import { observeScopeOwners, type ScopeOwners } from "./scope-owners.js";
import { createProcessObserver } from "./process-observation.js";
import type { ProcessObservation } from "./process-observation.js";
export * from "./contract.js";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function assertScope(scope: string): void {
  if (!digestPattern.test(scope)) {
    throw new NodeWorkAdmissionError("admission_invalid", "The Node work scope is invalid.");
  }
}

function assertPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new NodeWorkAdmissionError("admission_invalid", "The Node work owner PID is invalid.");
  }
}

function storedPid(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new NodeWorkAdmissionError("admission_invalid", "The stored Node owner PID is invalid.");
  }
  return value;
}

export function nodeWorkAdmissionScope(configPath: string): string {
  if (!isAbsolute(configPath) || configPath.includes("\0")) {
    throw new NodeWorkAdmissionError("admission_invalid", "The Node config path is invalid.");
  }
  return `sha256:${createHash("sha256").update(resolve(configPath)).digest("hex")}`;
}

export function nodeWorkAdmissionDatabasePath(repositoryRoot: string): string {
  if (!isAbsolute(repositoryRoot) || repositoryRoot.includes("\0")) {
    throw new NodeWorkAdmissionError("admission_invalid", "The repository root is invalid.");
  }
  return resolve(repositoryRoot, ".lervo", "data", "node-work-admission.sqlite");
}

type Row = Record<string, unknown>;

/** One SQLite admission authority shared by the installed Node and its service manager. */
export class SQLiteNodeWorkAdmission {
  private constructor(
    private readonly database: DatabaseSync,
    private readonly ownership: ProcessOwnership,
  ) {}

  static async open(input: {
    path: string;
    observeProcess?: (pid: number) => ProcessObservation;
  }): Promise<SQLiteNodeWorkAdmission> {
    return new SQLiteNodeWorkAdmission(
      await openAdmissionDatabase(input.path),
      new ProcessOwnership(input.observeProcess ?? createProcessObserver()),
    );
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private clearDeadSessions(scope: string, observed: ScopeOwners): void {
    const sessions = this.database
      .prepare("SELECT token, owner_pid, owner_identity FROM node_work_session WHERE scope = ?")
      .all(scope) as Row[];
    for (const session of sessions) {
      if (typeof session.token !== "string") {
        throw new NodeWorkAdmissionError(
          "admission_invalid",
          "The stored Node session is invalid.",
        );
      }
      if (
        observed.isStale(
          "session",
          session.token,
          storedPid(session.owner_pid),
          session.owner_identity,
        )
      ) {
        this.database.prepare("DELETE FROM node_work_session WHERE token = ?").run(session.token);
      }
    }
  }

  private clearDeadFreeze(scope: string, observed: ScopeOwners): void {
    const row = this.database
      .prepare(
        "SELECT freeze_token, freeze_pid, freeze_identity FROM node_work_scope WHERE scope = ?",
      )
      .get(scope) as Row | undefined;
    if (
      row?.freeze_pid !== null &&
      row?.freeze_pid !== undefined &&
      observed.isStale("freeze", row.freeze_token, storedPid(row.freeze_pid), row.freeze_identity)
    ) {
      this.database
        .prepare(
          "UPDATE node_work_scope SET freeze_token = NULL, freeze_pid = NULL, freeze_identity = NULL WHERE scope = ?",
        )
        .run(scope);
    }
  }

  registerSession(input: {
    scope: string;
    configDigest: string;
    ownerPid?: number;
  }): NodeWorkSession {
    assertScope(input.scope);
    assertScope(input.configDigest);
    const ownerPid = input.ownerPid ?? process.pid;
    assertPid(ownerPid);
    const identity = this.ownership.capture(ownerPid);
    const observed = observeScopeOwners(this.database, input.scope, this.ownership);
    return this.transaction(() => {
      this.database
        .prepare("INSERT OR IGNORE INTO node_work_scope (scope, config_digest) VALUES (?, ?)")
        .run(input.scope, input.configDigest);
      this.clearDeadSessions(input.scope, observed);
      this.clearDeadFreeze(input.scope, observed);
      const scope = this.database
        .prepare("SELECT config_digest, freeze_token FROM node_work_scope WHERE scope = ?")
        .get(input.scope) as Row;
      if (scope.freeze_token !== null && scope.config_digest !== input.configDigest) {
        throw new NodeWorkAdmissionError(
          "admission_invalid",
          "A frozen Node cannot change its configuration binding.",
        );
      }
      const existing = this.database
        .prepare("SELECT COUNT(*) AS count FROM node_work_session WHERE scope = ?")
        .get(input.scope) as Row;
      if (Number(existing.count) !== 0) {
        throw new NodeWorkAdmissionError(
          "admission_session_busy",
          "A Node already owns this work scope.",
        );
      }
      this.database
        .prepare("UPDATE node_work_scope SET config_digest = ? WHERE scope = ?")
        .run(input.configDigest, input.scope);
      const session = { token: randomUUID(), scope: input.scope, ownerPid };
      this.database
        .prepare(
          "INSERT INTO node_work_session (token, scope, owner_pid, owner_identity) VALUES (?, ?, ?, ?)",
        )
        .run(session.token, session.scope, session.ownerPid, identity);
      return session;
    });
  }

  /**
   * Ends one live session but retains its scope row: the row is the participation record
   * that lets a verified-inactive upgrade recover after a graceful stop, exactly as after a crash.
   */
  unregisterSession(session: NodeWorkSession): void {
    this.transaction(() => {
      this.database
        .prepare("DELETE FROM node_work_session WHERE token = ? AND scope = ? AND owner_pid = ?")
        .run(session.token, session.scope, session.ownerPid);
    });
  }

  tryAcquireWork(session: NodeWorkSession): NodeWorkClaim | null {
    const currentOwner = this.ownership.snapshot(session.ownerPid);
    const observed = observeScopeOwners(this.database, session.scope, this.ownership);
    return this.transaction(() => {
      const current = this.database
        .prepare("SELECT scope, owner_pid, owner_identity FROM node_work_session WHERE token = ?")
        .get(session.token) as Row | undefined;
      if (
        current?.scope !== session.scope ||
        storedPid(current.owner_pid) !== session.ownerPid ||
        !currentOwner.matches(session.ownerPid, current.owner_identity)
      ) {
        throw new NodeWorkAdmissionError(
          "admission_claim_lost",
          "The Node work session is absent.",
        );
      }
      this.clearDeadFreeze(session.scope, observed);
      const scope = this.database
        .prepare("SELECT freeze_token FROM node_work_scope WHERE scope = ?")
        .get(session.scope) as Row | undefined;
      if (scope?.freeze_token !== null) return null;
      const claim = { token: randomUUID(), sessionToken: session.token };
      this.database
        .prepare("INSERT INTO node_work_claim (token, session_token) VALUES (?, ?)")
        .run(claim.token, claim.sessionToken);
      return claim;
    });
  }

  releaseWork(claim: NodeWorkClaim): void {
    this.transaction(() => {
      const result = this.database
        .prepare("DELETE FROM node_work_claim WHERE token = ? AND session_token = ?")
        .run(claim.token, claim.sessionToken);
      if (result.changes !== 1) {
        throw new NodeWorkAdmissionError("admission_claim_lost", "The Node work claim is absent.");
      }
    });
  }

  tryFreeze(input: {
    scope: string;
    configDigest: string;
    ownerPid?: number;
    allowNoSession?: boolean;
  }): NodeUpgradeFreezeResult {
    assertScope(input.scope);
    assertScope(input.configDigest);
    const ownerPid = input.ownerPid ?? process.pid;
    assertPid(ownerPid);
    const identity = this.ownership.capture(ownerPid);
    const observed = observeScopeOwners(this.database, input.scope, this.ownership);
    return this.transaction(() => {
      this.clearDeadSessions(input.scope, observed);
      this.clearDeadFreeze(input.scope, observed);
      const scope = this.database
        .prepare("SELECT config_digest, freeze_token FROM node_work_scope WHERE scope = ?")
        .get(input.scope) as Row | undefined;
      if (scope === undefined) return { status: "busy", reason: "session_missing" };
      // The scope binds the configuration digest its Node registered with.
      if (scope.config_digest !== input.configDigest) {
        return { status: "busy", reason: "config_mismatch" };
      }
      if (scope.freeze_token !== null) return { status: "busy", reason: "upgrade_owned" };
      const sessions = this.database
        .prepare("SELECT token FROM node_work_session WHERE scope = ?")
        .all(input.scope) as Row[];
      if (sessions.length !== 1 && !(sessions.length === 0 && input.allowNoSession === true)) {
        return {
          status: "busy",
          reason: sessions.length === 0 ? "session_missing" : "session_conflict",
        };
      }
      const active = this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM node_work_claim JOIN node_work_session ON node_work_session.token = node_work_claim.session_token WHERE node_work_session.scope = ?",
        )
        .get(input.scope) as Row;
      if (Number(active.count) !== 0) return { status: "busy", reason: "active_work" };
      const freeze = { token: randomUUID(), scope: input.scope, ownerPid };
      this.database
        .prepare(
          "UPDATE node_work_scope SET freeze_token = ?, freeze_pid = ?, freeze_identity = ? WHERE scope = ?",
        )
        .run(freeze.token, freeze.ownerPid, identity, freeze.scope);
      return { status: "frozen", freeze };
    });
  }

  replaceFrozenConfiguration(input: {
    freeze: NodeUpgradeFreeze;
    expectedConfigDigest: string;
    configDigest: string;
  }): boolean {
    assertScope(input.freeze.scope);
    assertScope(input.expectedConfigDigest);
    assertScope(input.configDigest);
    assertPid(input.freeze.ownerPid);
    const currentOwner = this.ownership.snapshot(input.freeze.ownerPid);
    const observed = observeScopeOwners(this.database, input.freeze.scope, this.ownership);
    return this.transaction(() => {
      const owner = this.database
        .prepare(
          "SELECT freeze_identity FROM node_work_scope WHERE scope = ? AND freeze_token = ? AND freeze_pid = ?",
        )
        .get(input.freeze.scope, input.freeze.token, input.freeze.ownerPid) as Row | undefined;
      if (!owner || !currentOwner.matches(input.freeze.ownerPid, owner.freeze_identity))
        return false;
      this.clearDeadSessions(input.freeze.scope, observed);
      const sessions = this.database
        .prepare("SELECT COUNT(*) AS count FROM node_work_session WHERE scope = ?")
        .get(input.freeze.scope) as Row;
      if (Number(sessions.count) !== 0) return false;
      const result = this.database
        .prepare(
          "UPDATE node_work_scope SET config_digest = ? WHERE scope = ? AND config_digest = ? AND freeze_token = ? AND freeze_pid = ?",
        )
        .run(
          input.configDigest,
          input.freeze.scope,
          input.expectedConfigDigest,
          input.freeze.token,
          input.freeze.ownerPid,
        );
      return result.changes === 1;
    });
  }

  unfreeze(freeze: NodeUpgradeFreeze): boolean {
    const currentOwner = this.ownership.snapshot(freeze.ownerPid);
    return this.transaction(() => {
      const owner = this.database
        .prepare(
          "SELECT freeze_identity FROM node_work_scope WHERE scope = ? AND freeze_token = ? AND freeze_pid = ?",
        )
        .get(freeze.scope, freeze.token, freeze.ownerPid) as Row | undefined;
      if (!owner || !currentOwner.matches(freeze.ownerPid, owner.freeze_identity)) return false;
      const result = this.database
        .prepare(
          "UPDATE node_work_scope SET freeze_token = NULL, freeze_pid = NULL, freeze_identity = NULL WHERE scope = ? AND freeze_token = ? AND freeze_pid = ?",
        )
        .run(freeze.scope, freeze.token, freeze.ownerPid);
      return result.changes === 1;
    });
  }

  close(): void {
    this.database.close();
  }
}
