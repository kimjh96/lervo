// ADR-0660: the host's retention turns. Every repository on a host shares one disk, and the WSL
// host also runs the owner's training, so at most one retention slice starts per host in each
// pause, and repositories take turns, the one waiting longest first. The rows live in the host
// admission database beside the full-cycle admission, one row per repository.
//
// A pending request names when its owner comes back (`retry_at`). It holds its place only around
// that moment: earlier it does not block anyone, and once that moment is a grace past, the request
// is withdrawn. A request whose owner does not know when it returns (`retry_at` null) keeps its
// place and never blocks. So no request blocks a turn for longer than the grace, and a repository
// that keeps coming back when told is served after at most every older request.
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { sha256 } from "@lervo/repository-knowledge";
import { isSqliteLockContention } from "@lervo/sqlite-connection";

import { database, identifiedFailure } from "./full-cycle-admission-store.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

/** The pause between the end of one retention slice on a host and the start of the next. */
export const CAS_RETENTION_HOST_PAUSE_MILLISECONDS = 30_000;
/** How far around its `retry_at` a request counts as ready, and past it, abandoned. */
export const CAS_RETENTION_TURN_GRACE_MILLISECONDS = 15_000;
/** A row untouched for this long leaves the table. */
const ROW_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60_000;
const PAUSE = CAS_RETENTION_HOST_PAUSE_MILLISECONDS;
const GRACE = CAS_RETENTION_TURN_GRACE_MILLISECONDS;

/** A granted turn remembers the repository's previous slice, so an unused turn can be returned. */
export type RetentionTurn =
  { granted: true; previousSliceAt: number } | { granted: false; retryAt: number };

function repositoryHash(repositoryRoot: string): string {
  return sha256(resolve(repositoryRoot));
}

async function transaction<T>(directory: string, work: (db: DatabaseSync) => T): Promise<T> {
  const db = await database(directory);
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS retention_turns(repository_hash TEXT PRIMARY KEY,pending_since INTEGER,retry_at INTEGER,last_slice_at INTEGER NOT NULL,touched_at INTEGER NOT NULL)",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    throw isSqliteLockContention(error) ? error : identifiedFailure(error);
  } finally {
    db.close();
  }
}

/** The moment the host's pause after its last slice ends. */
function pauseEndsAt(db: DatabaseSync): number {
  const last = sqliteRow(db.prepare("SELECT max(last_slice_at) AS at FROM retention_turns").get());
  return Number(last?.at ?? 0) + PAUSE;
}

/**
 * Asks for the turn now. The request keeps the place it already holds. It is granted when the
 * host's pause has passed and no older request is ready; a denial says when to come back, and the
 * request holds its place for that moment. Lock contention denies it.
 */
export async function requestRetentionTurn(input: {
  directory: string;
  repositoryRoot: string;
  now: number;
}): Promise<RetentionTurn> {
  const hash = repositoryHash(input.repositoryRoot);
  const { now } = input;
  const deny = (db: DatabaseSync, retryAt: number): RetentionTurn => {
    db.prepare("UPDATE retention_turns SET retry_at=? WHERE repository_hash=?").run(retryAt, hash);
    return { granted: false, retryAt };
  };
  try {
    return await transaction(input.directory, (db) => {
      db.prepare(
        "UPDATE retention_turns SET pending_since=NULL,retry_at=NULL WHERE retry_at<?",
      ).run(now - GRACE);
      db.prepare("DELETE FROM retention_turns WHERE touched_at<?").run(
        now - ROW_RETENTION_MILLISECONDS,
      );
      db.prepare(
        "INSERT INTO retention_turns VALUES(?,?,?,0,?) ON CONFLICT(repository_hash) DO UPDATE SET pending_since=coalesce(pending_since,excluded.pending_since),retry_at=excluded.retry_at,touched_at=excluded.touched_at",
      ).run(hash, now, now, now);
      const pauseEnds = pauseEndsAt(db);
      if (now < pauseEnds) return deny(db, pauseEnds);
      const [first] = sqliteRows(
        db
          .prepare(
            "SELECT repository_hash FROM retention_turns WHERE pending_since IS NOT NULL AND retry_at<=? ORDER BY pending_since, repository_hash LIMIT 1",
          )
          .all(now + GRACE),
      );
      // The older ready request takes the turn within the grace; the pause then follows it.
      if (first?.repository_hash !== hash) return deny(db, now + PAUSE);
      const previous = sqliteRow(
        db.prepare("SELECT last_slice_at FROM retention_turns WHERE repository_hash=?").get(hash),
      );
      // The start counts as the host's last slice, so no other turn begins while this one runs.
      db.prepare(
        "UPDATE retention_turns SET last_slice_at=?,retry_at=NULL WHERE repository_hash=?",
      ).run(now, hash);
      return { granted: true, previousSliceAt: Number(previous?.last_slice_at ?? 0) };
    });
  } catch (error) {
    if (isSqliteLockContention(error)) return { granted: false, retryAt: now + PAUSE };
    throw error;
  }
}

/**
 * Ends a granted turn that ran. The pause runs from here. A repository with work left queues again
 * behind every older request, due back when the pause ends; one without work withdraws.
 */
export async function finishRetentionTurn(input: {
  directory: string;
  repositoryRoot: string;
  finishedAt: number;
  remaining: boolean;
}): Promise<void> {
  const { finishedAt, remaining } = input;
  await transaction(input.directory, (db) =>
    db
      .prepare(
        "UPDATE retention_turns SET last_slice_at=?,pending_since=?,retry_at=?,touched_at=? WHERE repository_hash=?",
      )
      .run(
        finishedAt,
        remaining ? finishedAt : null,
        remaining ? finishedAt + PAUSE : null,
        finishedAt,
        repositoryHash(input.repositoryRoot),
      ),
  );
}

/**
 * Gives back a granted turn that did no work, such as one that met live work or a busy admission:
 * the host's pause is as it was, and the request keeps its place without blocking anyone until
 * its owner asks again.
 */
export async function returnRetentionTurn(input: {
  directory: string;
  repositoryRoot: string;
  previousSliceAt: number;
}): Promise<void> {
  await transaction(input.directory, (db) =>
    db
      .prepare("UPDATE retention_turns SET last_slice_at=?,retry_at=NULL WHERE repository_hash=?")
      .run(input.previousSliceAt, repositoryHash(input.repositoryRoot)),
  );
}
