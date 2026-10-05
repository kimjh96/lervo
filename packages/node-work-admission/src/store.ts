import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

export interface NodeWorkSession {
  token: string;
  scope: string;
  ownerPid: number;
}

export interface NodeWorkClaim {
  token: string;
  sessionToken: string;
}

export interface NodeUpgradeFreeze {
  token: string;
  scope: string;
  ownerPid: number;
}

export type NodeUpgradeFreezeResult =
  | { status: "frozen"; freeze: NodeUpgradeFreeze }
  | {
      status: "busy";
      reason: "active_work" | "upgrade_owned" | "session_missing" | "session_conflict";
    };

export class NodeWorkAdmissionError extends Error {
  constructor(
    readonly code: "admission_invalid" | "admission_claim_lost" | "admission_session_busy",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NodeWorkAdmissionError";
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

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

async function ensureDatabasePath(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) {
    throw new NodeWorkAdmissionError("admission_invalid", "The admission path is invalid.");
  }
  const absolute = resolve(path);
  const directory = dirname(absolute);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (process.getuid !== undefined &&
      (parent.uid !== process.getuid() || (parent.mode & 0o022) !== 0))
  ) {
    throw new NodeWorkAdmissionError("admission_invalid", "The admission directory is unsafe.");
  }
  try {
    const handle = await open(
      absolute,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const file = await lstat(absolute);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.nlink !== 1 ||
    (process.getuid !== undefined && (file.uid !== process.getuid() || (file.mode & 0o077) !== 0))
  ) {
    throw new NodeWorkAdmissionError("admission_invalid", "The admission file is unsafe.");
  }
  return absolute;
}

type Row = Record<string, unknown>;

/** One SQLite admission authority shared by the installed Node and its service manager. */
export class SQLiteNodeWorkAdmission {
  private constructor(
    private readonly database: DatabaseSync,
    private readonly isAlive: (pid: number) => boolean,
  ) {}

  static async open(input: {
    path: string;
    isAlive?: (pid: number) => boolean;
  }): Promise<SQLiteNodeWorkAdmission> {
    const path = await ensureDatabasePath(input.path);
    const database = new DatabaseSync(path);
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 100;
      `);
      database.exec("BEGIN IMMEDIATE;");
      try {
        const version = (database.prepare("PRAGMA user_version;").get() as Row | undefined)
          ?.user_version;
        if (version !== 0 && version !== 1) {
          throw new NodeWorkAdmissionError(
            "admission_invalid",
            "The admission schema is unsupported.",
          );
        }
        if (version === 0) {
          database.exec(`
            CREATE TABLE node_work_scope (
              scope TEXT PRIMARY KEY,
              config_digest TEXT NOT NULL,
              freeze_token TEXT,
              freeze_pid INTEGER,
              CHECK ((freeze_token IS NULL) = (freeze_pid IS NULL))
            ) STRICT;
            CREATE TABLE node_work_session (
              token TEXT PRIMARY KEY,
              scope TEXT NOT NULL REFERENCES node_work_scope(scope),
              owner_pid INTEGER NOT NULL CHECK (owner_pid > 0)
            ) STRICT;
            CREATE INDEX node_work_session_scope ON node_work_session(scope);
            CREATE TABLE node_work_claim (
              token TEXT PRIMARY KEY,
              session_token TEXT NOT NULL REFERENCES node_work_session(token) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX node_work_claim_session ON node_work_claim(session_token);
            PRAGMA user_version = 1;
          `);
        }
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      return new SQLiteNodeWorkAdmission(database, input.isAlive ?? processAlive);
    } catch (error) {
      database.close();
      throw error;
    }
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

  private clearDeadSessions(scope: string): void {
    const sessions = this.database
      .prepare("SELECT token, owner_pid FROM node_work_session WHERE scope = ?")
      .all(scope) as Row[];
    for (const session of sessions) {
      if (typeof session.token !== "string") {
        throw new NodeWorkAdmissionError(
          "admission_invalid",
          "The stored Node session is invalid.",
        );
      }
      if (!this.isAlive(storedPid(session.owner_pid))) {
        this.database.prepare("DELETE FROM node_work_session WHERE token = ?").run(session.token);
      }
    }
  }

  private clearDeadFreeze(scope: string): void {
    const row = this.database
      .prepare("SELECT freeze_pid FROM node_work_scope WHERE scope = ?")
      .get(scope) as Row | undefined;
    if (
      row?.freeze_pid !== null &&
      row?.freeze_pid !== undefined &&
      !this.isAlive(storedPid(row.freeze_pid))
    ) {
      this.database
        .prepare(
          "UPDATE node_work_scope SET freeze_token = NULL, freeze_pid = NULL WHERE scope = ?",
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
    return this.transaction(() => {
      this.database
        .prepare("INSERT OR IGNORE INTO node_work_scope (scope, config_digest) VALUES (?, ?)")
        .run(input.scope, input.configDigest);
      this.clearDeadSessions(input.scope);
      this.clearDeadFreeze(input.scope);
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
        .prepare("INSERT INTO node_work_session (token, scope, owner_pid) VALUES (?, ?, ?)")
        .run(session.token, session.scope, session.ownerPid);
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
    return this.transaction(() => {
      const current = this.database
        .prepare("SELECT scope, owner_pid FROM node_work_session WHERE token = ?")
        .get(session.token) as Row | undefined;
      if (current?.scope !== session.scope || storedPid(current.owner_pid) !== session.ownerPid) {
        throw new NodeWorkAdmissionError(
          "admission_claim_lost",
          "The Node work session is absent.",
        );
      }
      this.clearDeadFreeze(session.scope);
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
    return this.transaction(() => {
      this.clearDeadSessions(input.scope);
      this.clearDeadFreeze(input.scope);
      const scope = this.database
        .prepare("SELECT config_digest, freeze_token FROM node_work_scope WHERE scope = ?")
        .get(input.scope) as Row | undefined;
      if (scope === undefined) return { status: "busy", reason: "session_missing" };
      if (scope.config_digest !== input.configDigest) {
        return { status: "busy", reason: "session_conflict" };
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
        .prepare("UPDATE node_work_scope SET freeze_token = ?, freeze_pid = ? WHERE scope = ?")
        .run(freeze.token, freeze.ownerPid, freeze.scope);
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
    return this.transaction(() => {
      if (!this.isAlive(input.freeze.ownerPid)) return false;
      this.clearDeadSessions(input.freeze.scope);
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
    return this.transaction(() => {
      const result = this.database
        .prepare(
          "UPDATE node_work_scope SET freeze_token = NULL, freeze_pid = NULL WHERE scope = ? AND freeze_token = ? AND freeze_pid = ?",
        )
        .run(freeze.scope, freeze.token, freeze.ownerPid);
      return result.changes === 1;
    });
  }

  close(): void {
    this.database.close();
  }
}
