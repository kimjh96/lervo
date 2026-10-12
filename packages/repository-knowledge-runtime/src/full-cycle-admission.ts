import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import { sha256 } from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow } from "./sqlite-row.js";

const LEASE_MILLISECONDS = 10 * 60_000;
const RENEW_MILLISECONDS = 60_000;
const POLL_MILLISECONDS = 1_000;
/** A waiter that has not polled for this long has gone and no longer holds its turn. */
const WAITER_STALE_MILLISECONDS = 30_000;

export interface FullCycleAdmission {
  release(): Promise<void>;
  /**
   * ADR-0485: whether another repository is waiting for its turn. The holder yields at its next
   * stage boundary, so one long cycle cannot starve every other resident on the host.
   */
  contended(): Promise<boolean>;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function database(directory: string): Promise<DatabaseSync> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  const path = resolve(directory, "full-cycle-admission.sqlite");
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
  await chmod(path, 0o600);
  db.exec(
    "CREATE TABLE IF NOT EXISTS holder(slot INTEGER PRIMARY KEY CHECK(slot=1),owner_pid INTEGER NOT NULL,nonce TEXT NOT NULL,repository_hash TEXT NOT NULL,acquired_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS waiters(nonce TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,repository_hash TEXT NOT NULL,since INTEGER NOT NULL,heartbeat INTEGER NOT NULL)",
  );
  return db;
}

async function tryAcquire(input: {
  directory: string;
  repositoryHash: string;
  nonce: string;
  now: number;
}): Promise<boolean> {
  const db = await database(input.directory);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const holder = sqliteRow(db.prepare("SELECT * FROM holder WHERE slot=1").get());
      const held =
        holder !== undefined &&
        Number(holder.expires_at) > input.now &&
        alive(Number(holder.owner_pid));
      // ADR-0485: waiters take turns in arrival order; a gone waiter forfeits its place.
      db.prepare("DELETE FROM waiters WHERE heartbeat<?").run(
        input.now - WAITER_STALE_MILLISECONDS,
      );
      db.prepare(
        "INSERT INTO waiters VALUES(?,?,?,?,?) ON CONFLICT(nonce) DO UPDATE SET heartbeat=excluded.heartbeat",
      ).run(input.nonce, process.pid, input.repositoryHash, input.now, input.now);
      const first = sqliteRow(
        db.prepare("SELECT nonce FROM waiters ORDER BY since, nonce LIMIT 1").get(),
      );
      const admitted = !held && first?.nonce === input.nonce;
      if (admitted) {
        db.prepare("INSERT OR REPLACE INTO holder VALUES(1,?,?,?,?,?)").run(
          process.pid,
          input.nonce,
          input.repositoryHash,
          input.now,
          input.now + LEASE_MILLISECONDS,
        );
        db.prepare("DELETE FROM waiters WHERE nonce=?").run(input.nonce);
      }
      db.exec("COMMIT");
      return admitted;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

async function othersWaiting(directory: string, nonce: string, now: number): Promise<boolean> {
  const db = await database(directory);
  try {
    return (
      sqliteRow(
        db
          .prepare("SELECT 1 AS waiting FROM waiters WHERE nonce<>? AND heartbeat>=? LIMIT 1")
          .get(nonce, now - WAITER_STALE_MILLISECONDS),
      ) !== undefined
    );
  } finally {
    db.close();
  }
}

async function update(directory: string, sql: string, ...values: (string | number)[]) {
  const db = await database(directory);
  try {
    db.prepare(sql).run(...values);
  } finally {
    db.close();
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolveDelay();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * One full knowledge cycle per host at a time, so co-hosted residents serialise their bursts.
 * Waiters are admitted in arrival order. Waiting ends on abort with `knowledge_cancelled`, which
 * withdraws the waiter; a dead or expired holder never blocks.
 */
export async function acquireFullCycleAdmission(input: {
  repositoryRoot: string;
  signal: AbortSignal;
  directory?: string;
  pollMilliseconds?: number;
  onWait?: () => void;
}): Promise<FullCycleAdmission> {
  const directory =
    input.directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission");
  const repositoryHash = sha256(resolve(input.repositoryRoot));
  const nonce = randomUUID();
  let waited = false;
  for (;;) {
    if (input.signal.aborted) {
      await update(directory, "DELETE FROM waiters WHERE nonce=?", nonce).catch(() => undefined);
      throw new KnowledgeConvergenceRuntimeError("knowledge_cancelled");
    }
    if (await tryAcquire({ directory, repositoryHash, nonce, now: Date.now() })) break;
    if (!waited) input.onWait?.();
    waited = true;
    await delay(
      (input.pollMilliseconds ?? POLL_MILLISECONDS) * (0.75 + Math.random() / 2),
      input.signal,
    );
  }
  const renewal = setInterval(() => {
    void update(
      directory,
      "UPDATE holder SET expires_at=? WHERE slot=1 AND nonce=?",
      Date.now() + LEASE_MILLISECONDS,
      nonce,
    ).catch(() => undefined);
  }, RENEW_MILLISECONDS);
  renewal.unref();
  let released = false;
  return {
    contended: () => othersWaiting(directory, nonce, Date.now()).catch(() => false),
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(renewal);
      await update(directory, "DELETE FROM holder WHERE slot=1 AND nonce=?", nonce);
    },
  };
}
