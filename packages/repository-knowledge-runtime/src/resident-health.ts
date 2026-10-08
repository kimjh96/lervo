import { mkdir, lstat, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

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
  const db = new DatabaseSync(path, { readOnly: !create });
  db.exec(create ? "PRAGMA busy_timeout=5000" : "PRAGMA busy_timeout=100");
  if (create) {
    await chmod(path, 0o600);
    db.exec(
      "CREATE TABLE IF NOT EXISTS residents(worker_hash TEXT PRIMARY KEY,pid INTEGER NOT NULL,heartbeat INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT)",
    );
  }
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
  const db = (await healthDatabase(input.repositoryRoot, true))!;
  try {
    db.exec("BEGIN IMMEDIATE");
    const now = (input.now ?? new Date()).getTime();
    const key = sha256(input.workerId);
    for (const row of sqliteRows(db.prepare("SELECT * FROM residents").all())) {
      if (
        String(row.worker_hash) !== key &&
        (now - Number(row.heartbeat) > 120_000 || !alive(Number(row.pid)))
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
  } finally {
    db.close();
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
      (item) => now.getTime() - Number(item.heartbeat) <= 120_000 && alive(Number(item.pid)),
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
