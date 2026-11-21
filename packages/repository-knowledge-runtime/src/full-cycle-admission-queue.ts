import type { DatabaseSync } from "node:sqlite";

import { probeProcessPresence, wakeProcessPresence } from "@lervo/project-storage";
import { isSqliteLockContention } from "@lervo/sqlite-connection";

import { database, identifiedFailure } from "./full-cycle-admission-store.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

/** Rows with the presence each holder or waiter of this release recorded beside them. */
const HOLDER =
  "SELECT h.*, p.presence FROM holder h LEFT JOIN admission_presence p ON p.nonce = h.nonce WHERE h.slot = 1";
const WAITERS =
  "SELECT w.*, p.presence FROM waiters w LEFT JOIN admission_presence p ON p.nonce = w.nonce";

/** A waiter of an earlier release that has not polled for this long has gone. */
export const WAITER_STALE_MILLISECONDS = 30_000;

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** A row's process: its presence when it has one, else its pid (an earlier release). */
async function rowAlive(row: { owner_pid?: unknown; presence?: unknown }): Promise<boolean> {
  if (typeof row.presence === "string") {
    const probe = await probeProcessPresence(row.presence);
    return probe === "alive" || (probe === "unknown" && alive(Number(row.owner_pid)));
  }
  return alive(Number(row.owner_pid));
}

/** What an attempt saw, so the waiter knows which signals can end its wait. */
export interface AdmissionAttempt {
  admitted: boolean;
  /** The holder's presence and lease expiry while it holds; null when free. */
  holder: { presence: string | null; expiresAt: number } | null;
  /** The presence of the waiter just ahead, if any. */
  ahead: string | null;
  /** A holder or waiter of an earlier release is present, which only a retry can observe. */
  legacy: boolean;
}

/**
 * ADR-0576: an attempt that meets lock contention is an attempt that was not admitted. ADR-0598:
 * one connection serves every attempt of an acquisition. ADR-0602: liveness is probed before the
 * write transaction, which never waits on another process.
 */
export async function tryAcquireOrWait(
  connection: { db: DatabaseSync | null },
  input: Parameters<typeof tryAcquire>[1] & { directory: string },
): Promise<AdmissionAttempt | null> {
  try {
    const db = (connection.db ??= await database(input.directory));
    const holder = sqliteRow(db.prepare(HOLDER).get());
    const holderLives = holder === undefined ? false : await rowAlive(holder);
    const dead: string[] = [];
    for (const row of sqliteRows(db.prepare(WAITERS).all()))
      if (row.nonce !== input.nonce && typeof row.presence === "string" && !(await rowAlive(row)))
        dead.push(String(row.nonce));
    return tryAcquire(db, { ...input, probedHolder: holder?.nonce ?? null, holderLives, dead });
  } catch (error) {
    if (isSqliteLockContention(error)) return null;
    throw identifiedFailure(error);
  }
}

function tryAcquire(
  db: DatabaseSync,
  input: {
    repositoryHash: string;
    nonce: string;
    since: number;
    now: number;
    leaseMilliseconds: number;
    presence: string | null;
    probedHolder?: unknown;
    holderLives?: boolean;
    dead?: readonly string[];
  },
): AdmissionAttempt {
  db.exec("BEGIN IMMEDIATE");
  try {
    const holder = sqliteRow(db.prepare(HOLDER).get());
    // ADR-0577: an expired lease frees the slot even while its process lives. A holder that
    // changed since it was probed is taken as live; its release or exit signals again.
    const lives =
      holder === undefined
        ? false
        : holder.nonce === input.probedHolder
          ? input.holderLives === true
          : true;
    const held = holder !== undefined && Number(holder.expires_at) > input.now && lives;
    // ADR-0485: waiters take turns in arrival order; a gone waiter forfeits its place. ADR-0602:
    // a waiter with a presence is gone when its presence is; an earlier release's by heartbeat.
    for (const nonce of input.dead ?? [])
      db.prepare("DELETE FROM waiters WHERE nonce=?").run(nonce);
    db.prepare(
      "DELETE FROM waiters WHERE heartbeat<? AND nonce NOT IN (SELECT nonce FROM admission_presence)",
    ).run(input.now - WAITER_STALE_MILLISECONDS);
    // Rows are inserted by position, as earlier releases insert them.
    db.prepare(
      "INSERT INTO waiters VALUES(?,?,?,?,?) ON CONFLICT(nonce) DO UPDATE SET heartbeat=excluded.heartbeat",
    ).run(input.nonce, process.pid, input.repositoryHash, input.since, input.now);
    if (input.presence !== null)
      db.prepare("INSERT OR REPLACE INTO admission_presence VALUES(?,?)").run(
        input.nonce,
        input.presence,
      );
    // Presence rows of holders and waiters that an earlier release removed.
    db.exec(
      "DELETE FROM admission_presence WHERE nonce NOT IN (SELECT nonce FROM waiters UNION SELECT nonce FROM holder)",
    );
    const queue = sqliteRows(db.prepare(`${WAITERS} ORDER BY w.since, w.nonce`).all());
    const position = queue.findIndex((row) => row.nonce === input.nonce);
    const admitted = !held && position === 0;
    if (admitted) {
      db.prepare("INSERT OR REPLACE INTO holder VALUES(1,?,?,?,?,?)").run(
        process.pid,
        input.nonce,
        input.repositoryHash,
        input.now,
        input.now + input.leaseMilliseconds,
      );
      db.prepare("DELETE FROM waiters WHERE nonce=?").run(input.nonce);
    }
    db.exec("COMMIT");
    const ahead = position > 0 ? queue[position - 1]! : null;
    return {
      admitted,
      holder:
        held && holder !== undefined
          ? {
              presence: typeof holder.presence === "string" ? holder.presence : null,
              expiresAt: Number(holder.expires_at),
            }
          : null,
      ahead: ahead !== null && typeof ahead.presence === "string" ? ahead.presence : null,
      // Mixed versions only: a holder or waiter of an earlier release either blocks this waiter
      // without a signal or deletes rows by heartbeat age, so this waiter keeps retrying, which
      // refreshes its heartbeat, until none is left.
      legacy:
        (holder !== undefined && typeof holder.presence !== "string") ||
        queue.some((row) => typeof row.presence !== "string"),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * `registeredBefore` limits the answer to upgrades, whose turn is registered a year back.
 * ADR-0602: a waiter counts while its presence answers; an earlier release's while it heartbeats.
 */
export async function othersWaiting(
  directory: string,
  nonce: string,
  now: number,
  registeredBefore = Number.MAX_SAFE_INTEGER,
): Promise<boolean> {
  const db = await database(directory);
  try {
    const rows = sqliteRows(
      db
        .prepare(
          `${WAITERS} WHERE w.nonce<>? AND w.since<? AND (p.presence IS NOT NULL OR w.heartbeat>=?)`,
        )
        .all(nonce, registeredBefore, now - WAITER_STALE_MILLISECONDS),
    );
    for (const row of rows) if (await rowAlive(row)) return true;
    return false;
  } finally {
    db.close();
  }
}

/** Wakes every waiter's presence, so a release or a departure is seen at once. */
export async function wakeWaiters(directory: string, except: string): Promise<void> {
  const db = await database(directory);
  let tokens: string[];
  try {
    tokens = sqliteRows(
      db.prepare(`${WAITERS} WHERE w.nonce<>? AND p.presence IS NOT NULL`).all(except),
    ).map((row) => String(row.presence));
  } finally {
    db.close();
  }
  await Promise.all(tokens.map((token) => wakeProcessPresence(token)));
}

/** Returns the number of rows the statement changed. */
export async function update(
  directory: string,
  sql: string,
  ...values: (string | number)[]
): Promise<number> {
  const db = await database(directory);
  try {
    return Number(db.prepare(sql).run(...values).changes);
  } finally {
    db.close();
  }
}
