import { chmod, lstat, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";

const DATABASE_NAME = "full-cycle-admission.sqlite";
/**
 * The base wait between admission retries. ADR-0602: a waiter of this release retries only on a
 * signal (a ping, a holder's or the waiter ahead's exit, a lease's expiry); this backoff applies
 * only while a holder or waiter of an earlier release, which records no presence, is in the way,
 * and to lock contention.
 */
export const POLL_MILLISECONDS = 1_000;
/**
 * ADR-0598: that retry backs off from the base, doubling to at most eight times it and never past
 * eight seconds, so an earlier release's waiter, which still heartbeats, never loses its turn.
 */
const MAXIMUM_POLL_MULTIPLE = 8;
const MAXIMUM_POLL_MILLISECONDS = 8_000;

/** The wait before the next admission poll after one of `poll` milliseconds (ADR-0598). */
export function nextAdmissionPoll(poll: number, basePoll = POLL_MILLISECONDS): number {
  const maximum = Math.max(
    basePoll,
    Math.min(basePoll * MAXIMUM_POLL_MULTIPLE, MAXIMUM_POLL_MILLISECONDS),
  );
  return Math.min(poll * 2, maximum);
}

/** Opens the host admission database, refusing a symlinked or non-file coordinate. */
export async function database(directory: string): Promise<DatabaseSync> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  const path = resolve(directory, DATABASE_NAME);
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
  try {
    await chmod(path, 0o600);
    // ADR-0576: every waiter writes a heartbeat each poll. In rollback-journal mode a commit
    // holds the file exclusively while it waits for readers and syncs, so co-hosted waiters
    // convoy past the busy timeout. WAL lets readers proceed and keeps each write short. The
    // rows only coordinate live processes, so a commit lost to power failure loses nothing.
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    db.exec(
      "CREATE TABLE IF NOT EXISTS holder(slot INTEGER PRIMARY KEY CHECK(slot=1),owner_pid INTEGER NOT NULL,nonce TEXT NOT NULL,repository_hash TEXT NOT NULL,acquired_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)",
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS waiters(nonce TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,repository_hash TEXT NOT NULL,since INTEGER NOT NULL,heartbeat INTEGER NOT NULL)",
    );
    // ADR-0602: each holder and waiter names its process presence in a table of its own, so
    // earlier releases, which insert rows by position, never see a changed column list.
    db.exec(
      "CREATE TABLE IF NOT EXISTS admission_presence(nonce TEXT PRIMARY KEY,presence TEXT NOT NULL)",
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * ADR-0576: a SQLite failure that leaves this module names the admission database, so a command
 * that reports only an error code and message still identifies which host database failed. The
 * SQLite `code` and `errcode` are kept.
 */
export function identifiedFailure(error: unknown): unknown {
  const { code, errcode } = (error ?? {}) as { code?: unknown; errcode?: unknown };
  if (!(error instanceof Error) || typeof code !== "string" || !code.startsWith("ERR_SQLITE"))
    return error;
  return Object.assign(new Error(`${DATABASE_NAME}: ${error.message}`, { cause: error }), {
    code,
    errcode,
  });
}
