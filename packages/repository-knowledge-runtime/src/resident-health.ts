import { mkdir, lstat, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { sha256 } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

/** A heartbeat older than this, or a dead process, no longer proves a running resident. */
export const RESIDENT_HEALTH_STALE_MILLISECONDS = 120_000;
/**
 * ADR-0599: an unchanged resident rewrites its heartbeat at this interval, so a resident whose
 * event loop is blocked for up to 75 seconds still reads as running under the stale bound; a
 * state change is written at once by the loop's `report`.
 */
export const RESIDENT_HEALTH_HEARTBEAT_MILLISECONDS = 45_000;

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
  }
  return db;
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

/** A bounded private heartbeat projection proves hosting, never document currency or authority. */
export async function recordKnowledgeResidentHealth(input: {
  repositoryRoot: string;
  workerId: string;
  state: KnowledgeResidentState;
  reason?: string | null;
  now?: Date;
}): Promise<void> {
  const db = await writeHandle(input.repositoryRoot);
  let committed = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    const now = (input.now ?? new Date()).getTime();
    const key = sha256(input.workerId);
    for (const row of sqliteRows(db.prepare("SELECT * FROM residents").all())) {
      if (
        String(row.worker_hash) !== key &&
        (now - Number(row.heartbeat) > RESIDENT_HEALTH_STALE_MILLISECONDS ||
          !alive(Number(row.pid)))
      )
        db.prepare("DELETE FROM residents WHERE worker_hash=?").run(String(row.worker_hash));
    }
    if (
      sqliteRow(db.prepare("SELECT worker_hash FROM residents WHERE worker_hash=?").get(key)) ===
        undefined &&
      Number(sqliteRow(db.prepare("SELECT count(*) AS count FROM residents").get())!.count) >= 64
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
    db.prepare(
      "INSERT INTO residents VALUES(?,?,?,?,?) ON CONFLICT(worker_hash) DO UPDATE SET pid=excluded.pid,heartbeat=excluded.heartbeat,state=excluded.state,reason=excluded.reason",
    ).run(key, process.pid, now, input.state, input.reason?.slice(0, 128) ?? null);
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
            .prepare("SELECT * FROM residents WHERE state != 'stopped' ORDER BY heartbeat DESC")
            .all(),
        )
      : [];
    const row = residents.find(
      (item) =>
        now.getTime() - Number(item.heartbeat) <= RESIDENT_HEALTH_STALE_MILLISECONDS &&
        alive(Number(item.pid)),
    );
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
