import { mkdir, lstat, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { probeProcessPresence } from "@lervo/project-storage";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { sha256 } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

/**
 * ADR-0602: a resident proves it runs through its process presence, probed when health is read;
 * it writes its row only when its state changes. A row without a presence (a resident of an
 * earlier release, which still heartbeats) is judged by this heartbeat age and its process.
 */
export const RESIDENT_HEALTH_STALE_MILLISECONDS = 120_000;

export type KnowledgeResidentState =
  "running" | "idle" | "waiting" | "attention" | "busy" | "stopped";
export interface KnowledgeResidentHealth {
  status: "healthy" | "degraded" | "not_running";
  state: KnowledgeResidentState | null;
  heartbeatAt: string | null;
  reason: string | null;
}

async function healthDatabase(root: string, create: boolean): Promise<DatabaseSync | null> {
  let directory = root;
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    if (create)
      await mkdir(directory, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  const path = resolve(directory, "resident-health.sqlite");
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!create) return null;
  }
  const db = openSqliteDatabase(path, {
    busyTimeoutMs: create ? SQLITE_BUSY_TIMEOUT_MS : 100,
    readOnly: !create,
  });
  if (create) {
    await chmod(path, 0o600);
    db.exec(
      "CREATE TABLE IF NOT EXISTS residents(worker_hash TEXT PRIMARY KEY,pid INTEGER NOT NULL,heartbeat INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT)",
    );
    // ADR-0602: presence lives in a table of its own, so residents of earlier releases, which
    // insert rows by position, never see a changed column list.
    db.exec(
      "CREATE TABLE IF NOT EXISTS resident_presence(worker_hash TEXT PRIMARY KEY,presence TEXT NOT NULL)",
    );
  }
  return db;
}

/** Residents with the presence each one of this release recorded beside its row. */
const RESIDENTS =
  "SELECT r.*, p.presence FROM residents r LEFT JOIN resident_presence p ON p.worker_hash = r.worker_hash";

/** A database no resident of this release wrote yet has no presence table. */
function presenceTable(db: DatabaseSync): boolean {
  return (
    sqliteRow(
      db
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='resident_presence'",
        )
        .get(),
    ) !== undefined
  );
}

interface WriteHandle {
  db: DatabaseSync;
  /** The database file's inode, so a replaced or removed file is reopened, never written blind. */
  inode: bigint;
}
/** ADR-0599: one write handle per repository, so a heartbeat runs no mkdir, chmod or DDL. */
const writeHandles = new Map<string, WriteHandle>();
const MAXIMUM_WRITE_HANDLES = 64;

function healthPath(root: string): string {
  return resolve(root, ".lervo", "state", "knowledge", "resident-health.sqlite");
}

function closeWriteHandle(root: string): void {
  const handle = writeHandles.get(root);
  writeHandles.delete(root);
  try {
    handle?.db.close();
  } catch {
    /* Already closed. */
  }
}

async function writeHandle(root: string): Promise<DatabaseSync> {
  const cached = writeHandles.get(root);
  if (cached !== undefined) {
    const stat = await lstat(healthPath(root), { bigint: true }).catch(() => null);
    if (stat !== null && stat.isFile() && stat.ino === cached.inode) return cached.db;
    closeWriteHandle(root);
  }
  const db = (await healthDatabase(root, true))!;
  const inode = (await lstat(healthPath(root), { bigint: true })).ino;
  if (writeHandles.size >= MAXIMUM_WRITE_HANDLES)
    closeWriteHandle(writeHandles.keys().next().value!);
  writeHandles.set(root, { db, inode });
  return db;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Whether a row's resident runs: its presence when it has one (a presence this host cannot judge
 * falls back to its process), else the earlier heartbeat rule.
 */
async function rowAlive(row: Record<string, unknown>, now: number): Promise<boolean> {
  if (typeof row.presence === "string") {
    const probe = await probeProcessPresence(row.presence);
    return probe === "alive" || (probe === "unknown" && alive(Number(row.pid)));
  }
  return (
    now - Number(row.heartbeat) <= RESIDENT_HEALTH_STALE_MILLISECONDS && alive(Number(row.pid))
  );
}

/** A bounded private projection proves hosting, never document currency or authority. */
export async function recordKnowledgeResidentHealth(input: {
  repositoryRoot: string;
  workerId: string;
  state: KnowledgeResidentState;
  reason?: string | null;
  /** ADR-0602: the writer's process presence token, which readers probe. */
  presence?: string | null;
  now?: Date;
}): Promise<void> {
  const db = await writeHandle(input.repositoryRoot);
  const now = (input.now ?? new Date()).getTime();
  const key = sha256(input.workerId);
  // Probed before the write transaction, which must not wait on another process.
  const dead: string[] = [];
  for (const row of sqliteRows(db.prepare(RESIDENTS).all()))
    if (String(row.worker_hash) !== key && !(await rowAlive(row, now)))
      dead.push(String(row.worker_hash));
  let committed = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const hash of dead) db.prepare("DELETE FROM residents WHERE worker_hash=?").run(hash);
    db.exec(
      "DELETE FROM resident_presence WHERE worker_hash NOT IN (SELECT worker_hash FROM residents)",
    );
    if (
      sqliteRow(db.prepare("SELECT worker_hash FROM residents WHERE worker_hash=?").get(key)) ===
        undefined &&
      Number(sqliteRow(db.prepare("SELECT count(*) AS count FROM residents").get())!.count) >= 64
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
    // Inserted by position, as earlier releases insert it.
    db.prepare(
      "INSERT INTO residents VALUES(?,?,?,?,?) ON CONFLICT(worker_hash) DO UPDATE SET pid=excluded.pid,heartbeat=excluded.heartbeat,state=excluded.state,reason=excluded.reason",
    ).run(key, process.pid, now, input.state, input.reason?.slice(0, 128) ?? null);
    if (input.presence === undefined || input.presence === null)
      db.prepare("DELETE FROM resident_presence WHERE worker_hash=?").run(key);
    else
      db.prepare("INSERT OR REPLACE INTO resident_presence VALUES(?,?)").run(key, input.presence);
    db.exec("COMMIT");
    committed = true;
  } finally {
    // A failed write drops the handle, so the next heartbeat starts from a fresh connection; a
    // stopped resident releases it, so a removed repository holds no open database.
    if (!committed || input.state === "stopped") {
      try {
        if (!committed) db.exec("ROLLBACK");
      } catch {
        /* No open transaction. */
      }
      closeWriteHandle(input.repositoryRoot);
    }
  }
}

export async function inspectKnowledgeResidentHealth(
  root: string,
  now = new Date(),
): Promise<KnowledgeResidentHealth> {
  const db = await healthDatabase(root, false);
  try {
    const residents = db
      ? sqliteRows(
          db
            .prepare(
              `${presenceTable(db) ? RESIDENTS : "SELECT r.* FROM residents r"} WHERE r.state != 'stopped' ORDER BY r.heartbeat DESC`,
            )
            .all(),
        )
      : [];
    let row: Record<string, unknown> | undefined;
    for (const item of residents)
      if (await rowAlive(item, now.getTime())) {
        row = item;
        break;
      }
    if (!row)
      return {
        status: "not_running",
        state: null,
        heartbeatAt: null,
        reason: "knowledge_resident_absent",
      };
    return {
      status: row.state === "attention" ? "degraded" : "healthy",
      state: row.state as KnowledgeResidentState,
      heartbeatAt: new Date(Number(row.heartbeat)).toISOString(),
      reason: typeof row.reason === "string" ? row.reason : null,
    };
  } finally {
    db?.close();
  }
}
