// ADR-0660: the host's retention turns. Every repository on a host shares one disk, and the WSL
// host also runs the owner's training, so at most one retention slice starts per host in each
// pause, and repositories take turns, the one waiting longest first. The rows live in the host
// admission database beside the full-cycle admission, one row per repository.
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { sha256 } from "@lervo/repository-knowledge";
import { isSqliteLockContention } from "@lervo/sqlite-connection";

import { database, identifiedFailure } from "./full-cycle-admission-store.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

/** The pause between the end of one retention slice on a host and the start of the next. */
export const CAS_RETENTION_HOST_PAUSE_MILLISECONDS = 30_000;
/**
 * A request not renewed for this long does not hold its place: its resident stopped asking, or
 * backs off behind live work, and asks again later with its original place.
 */
const REQUEST_STALE_MILLISECONDS = 2 * CAS_RETENTION_HOST_PAUSE_MILLISECONDS;
/** A repository with no pending request and no slice for this long leaves the table. */
const ROW_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60_000;

export type RetentionTurn = { granted: true } | { granted: false; retryAt: number };

function turns(db: DatabaseSync): DatabaseSync {
  db.exec(
    "CREATE TABLE IF NOT EXISTS retention_turns(repository_hash TEXT PRIMARY KEY,pending_since INTEGER,heartbeat INTEGER NOT NULL,last_slice_at INTEGER NOT NULL)",
  );
  return db;
}

function repositoryHash(repositoryRoot: string): string {
  return sha256(resolve(repositoryRoot));
}

async function transaction<T>(directory: string, work: (db: DatabaseSync) => T): Promise<T> {
  const db = turns(await database(directory));
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

/**
 * Records this repository's request, keeping its place if it already waits, and grants the turn
 * only when the host's pause has passed and no live request is older. Lock contention denies it.
 */
export async function requestRetentionTurn(input: {
  directory: string;
  repositoryRoot: string;
  pendingSince: number;
  now: number;
}): Promise<RetentionTurn> {
  const hash = repositoryHash(input.repositoryRoot);
  const { now } = input;
  try {
    return await transaction(input.directory, (db) => {
      db.prepare(
        "INSERT INTO retention_turns VALUES(?,?,?,0) ON CONFLICT(repository_hash) DO UPDATE SET pending_since=coalesce(pending_since,excluded.pending_since),heartbeat=excluded.heartbeat",
      ).run(hash, input.pendingSince, now);
      db.prepare(
        "DELETE FROM retention_turns WHERE pending_since IS NULL AND last_slice_at<? AND heartbeat<?",
      ).run(now - ROW_RETENTION_MILLISECONDS, now - ROW_RETENTION_MILLISECONDS);
      const last = Number(
        sqliteRow(db.prepare("SELECT max(last_slice_at) AS at FROM retention_turns").get())?.at ??
          0,
      );
      if (now < last + CAS_RETENTION_HOST_PAUSE_MILLISECONDS)
        return { granted: false, retryAt: last + CAS_RETENTION_HOST_PAUSE_MILLISECONDS };
      const [first] = sqliteRows(
        db
          .prepare(
            "SELECT repository_hash FROM retention_turns WHERE pending_since IS NOT NULL AND heartbeat>=? ORDER BY pending_since, repository_hash LIMIT 1",
          )
          .all(now - REQUEST_STALE_MILLISECONDS),
      );
      if (first?.repository_hash !== hash)
        return { granted: false, retryAt: now + CAS_RETENTION_HOST_PAUSE_MILLISECONDS };
      // The start counts as the host's last slice, so no other turn begins while this one runs.
      db.prepare("UPDATE retention_turns SET last_slice_at=? WHERE repository_hash=?").run(
        now,
        hash,
      );
      return { granted: true };
    });
  } catch (error) {
    if (isSqliteLockContention(error))
      return { granted: false, retryAt: now + CAS_RETENTION_HOST_PAUSE_MILLISECONDS };
    throw identifiedFailure(error);
  }
}

/**
 * Ends a granted turn. The pause runs from here. A repository with work left queues again behind
 * every repository that waited longer; one without work withdraws its request.
 */
export async function finishRetentionTurn(input: {
  directory: string;
  repositoryRoot: string;
  finishedAt: number;
  remaining: boolean;
}): Promise<void> {
  await transaction(input.directory, (db) =>
    db
      .prepare(
        "UPDATE retention_turns SET last_slice_at=?,pending_since=?,heartbeat=? WHERE repository_hash=?",
      )
      .run(
        input.finishedAt,
        input.remaining ? input.finishedAt : null,
        input.finishedAt,
        repositoryHash(input.repositoryRoot),
      ),
  ).catch((error: unknown) => {
    throw identifiedFailure(error);
  });
}
