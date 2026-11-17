import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import {
  isSqliteLockContention,
  openSqliteDatabase,
  SQLITE_BUSY_TIMEOUT_MS,
} from "@lervo/sqlite-connection";

import { sha256 } from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow } from "./sqlite-row.js";

const DATABASE_NAME = "full-cycle-admission.sqlite";
const LEASE_MILLISECONDS = 10 * 60_000;
/** A holder renews this often, or ten times per lease when its lease is shorter. */
const RENEW_MILLISECONDS = 60_000;
const POLL_MILLISECONDS = 1_000;
/**
 * ADR-0577: how long `confirm()` retries lock contention before it answers `unconfirmed`. One
 * attempt can wait out the 5-second busy timeout, and ADR-0576 saw convoys outlast it, so the
 * budget allows several attempts. It is measured on the monotonic clock, because the answer must
 * not depend on a wall clock that can step back.
 */
const CONFIRM_CONTENTION_WAIT_MILLISECONDS = 30_000;
/** A waiter that has not polled for this long has gone and no longer holds its turn. */
const WAITER_STALE_MILLISECONDS = 30_000;
/**
 * ADR-0574: an upgrade registers its turn this far in the past. Every reader orders waiters by
 * `since`, including residents of earlier releases, so the upgrade is admitted before every
 * waiting resident without a schema change, and upgrades keep arrival order among themselves.
 */
const PRIORITY_ADVANCE_MILLISECONDS = 365 * 24 * 60 * 60_000;

/**
 * - `resident`: a background full cycle; it takes its turn in arrival order.
 * - `upgrade`: `lervo upgrade --apply`; it goes ahead of waiting residents, and a running cycle
 *   stops at its next stage boundary.
 */
export type FullCycleAdmissionPriority = "resident" | "upgrade";

/**
 * - `held`: this holder still holds the admission.
 * - `lost`: another holder was admitted after this lease lapsed. A loss is final.
 * - `unconfirmed`: lock contention outlasted the retry budget, so neither is proven.
 */
export type FullCycleAdmissionConfirmation = "held" | "lost" | "unconfirmed";

export interface FullCycleAdmission {
  release(): Promise<void>;
  /**
   * ADR-0485: whether another repository is waiting for its turn. The holder yields at its next
   * stage boundary, so one long cycle cannot starve every other resident on the host.
   */
  contended(): Promise<boolean>;
  /**
   * ADR-0574: whether an upgrade is waiting. The holder stops at its next stage boundary, before
   * starting any further stage, instead of after its next convergence stage.
   */
  preempted(): Promise<boolean>;
  /**
   * ADR-0577: whether this holder still holds the admission, confirmed against the database and
   * renewed in the same statement. Admission replaces the holder row, and its nonce never comes
   * back, so `held` also proves that no other holder was admitted since this one. Only `held`
   * lets a holder act: contention past the retry budget answers `unconfirmed`, and other
   * database failures throw.
   */
  confirm(): Promise<FullCycleAdmissionConfirmation>;
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
function identifiedFailure(error: unknown): unknown {
  const { code, errcode } = (error ?? {}) as { code?: unknown; errcode?: unknown };
  if (!(error instanceof Error) || typeof code !== "string" || !code.startsWith("ERR_SQLITE"))
    return error;
  return Object.assign(new Error(`${DATABASE_NAME}: ${error.message}`, { cause: error }), {
    code,
    errcode,
  });
}

/** ADR-0576: a poll that meets lock contention is a poll that was not admitted. */
async function tryAcquireOrWait(input: Parameters<typeof tryAcquire>[0]): Promise<boolean> {
  try {
    return await tryAcquire(input);
  } catch (error) {
    if (isSqliteLockContention(error)) return false;
    throw identifiedFailure(error);
  }
}

async function tryAcquire(input: {
  directory: string;
  repositoryHash: string;
  nonce: string;
  since: number;
  now: number;
  leaseMilliseconds: number;
}): Promise<boolean> {
  const db = await database(input.directory);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const holder = sqliteRow(db.prepare("SELECT * FROM holder WHERE slot=1").get());
      // ADR-0577: an expired lease frees the slot even while its process lives. Residents of
      // earlier releases apply the same rule, so only the holder's own lease length protects it.
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
      ).run(input.nonce, process.pid, input.repositoryHash, input.since, input.now);
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
          input.now + input.leaseMilliseconds,
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

/** `registeredBefore` limits the answer to upgrades, whose turn is registered a year back. */
async function othersWaiting(
  directory: string,
  nonce: string,
  now: number,
  registeredBefore = Number.MAX_SAFE_INTEGER,
): Promise<boolean> {
  const db = await database(directory);
  try {
    return (
      sqliteRow(
        db
          .prepare(
            "SELECT 1 AS waiting FROM waiters WHERE nonce<>? AND heartbeat>=? AND since<? LIMIT 1",
          )
          .get(nonce, now - WAITER_STALE_MILLISECONDS, registeredBefore),
      ) !== undefined
    );
  } finally {
    db.close();
  }
}

/** Returns the number of rows the statement changed. */
async function update(
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
 * Upgrades are admitted first, then residents, each in arrival order. Waiting ends on abort with
 * `knowledge_cancelled`, which withdraws the waiter; a dead or expired holder never blocks.
 */
export async function acquireFullCycleAdmission(input: {
  repositoryRoot: string;
  signal: AbortSignal;
  directory?: string;
  pollMilliseconds?: number;
  priority?: FullCycleAdmissionPriority;
  /**
   * ADR-0576: how long `release()` retries lock contention. By default it retries until the
   * lease lapses, which a long-lived resident needs because its live process keeps the row held.
   * A short-lived command gives up sooner: its holder row stops counting when its process exits.
   */
  releaseContentionWaitMilliseconds?: number;
  /** ADR-0577: how long `confirm()` retries lock contention; 30 seconds by default. */
  confirmContentionWaitMilliseconds?: number;
  /**
   * ADR-0577: how long the lease lasts without renewal; ten minutes by default. A holder whose
   * event loop can stall longer, such as an upgrade under host load, asks for more. A dead
   * holder still frees the slot at once.
   */
  leaseMilliseconds?: number;
  onWait?: () => void;
}): Promise<FullCycleAdmission> {
  const directory =
    input.directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission");
  const repositoryHash = sha256(resolve(input.repositoryRoot));
  const nonce = randomUUID();
  const since = Date.now() - (input.priority === "upgrade" ? PRIORITY_ADVANCE_MILLISECONDS : 0);
  const leaseMilliseconds = input.leaseMilliseconds ?? LEASE_MILLISECONDS;
  let waited = false;
  let admittedAt: number;
  for (;;) {
    if (input.signal.aborted) {
      await update(directory, "DELETE FROM waiters WHERE nonce=?", nonce).catch(() => undefined);
      throw new KnowledgeConvergenceRuntimeError("knowledge_cancelled");
    }
    admittedAt = Date.now();
    if (
      await tryAcquireOrWait({
        directory,
        repositoryHash,
        nonce,
        since,
        now: admittedAt,
        leaseMilliseconds,
      })
    )
      break;
    if (!waited) input.onWait?.();
    waited = true;
    await delay(
      (input.pollMilliseconds ?? POLL_MILLISECONDS) * (0.75 + Math.random() / 2),
      input.signal,
    );
  }
  /** The latest expiry this holder wrote and saw applied; the row never holds an earlier one. */
  let expiresAt = admittedAt + leaseMilliseconds;
  let lost = false;
  let released = false;
  // ADR-0577: renewal matches this holder's nonce. Zero changed rows mean another holder was
  // admitted after this lease lapsed, so the admission is lost for good. `max` keeps a slower
  // renewal from shortening a later one. Lock contention leaves the answer open.
  const renew = async (): Promise<"held" | "lost" | "contended"> => {
    if (lost || released) return "lost";
    const renewed = Date.now() + leaseMilliseconds;
    let changes: number;
    try {
      changes = await update(
        directory,
        "UPDATE holder SET expires_at=max(expires_at,?) WHERE slot=1 AND nonce=?",
        renewed,
        nonce,
      );
    } catch (error) {
      if (isSqliteLockContention(error)) return "contended";
      throw identifiedFailure(error);
    }
    if (changes !== 1) {
      lost = true;
      clearInterval(renewal);
      return "lost";
    }
    expiresAt = Math.max(expiresAt, renewed);
    return "held";
  };
  // The timer only renews; a contended renewal waits for the next tick.
  const renewal = setInterval(
    () => void renew().catch(() => undefined),
    Math.min(RENEW_MILLISECONDS, Math.max(1, Math.floor(leaseMilliseconds / 10))),
  );
  renewal.unref();
  return {
    confirm: async () => {
      const giveUpAt =
        performance.now() +
        (input.confirmContentionWaitMilliseconds ?? CONFIRM_CONTENTION_WAIT_MILLISECONDS);
      for (;;) {
        const answer = await renew();
        if (answer !== "contended") return answer;
        if (performance.now() >= giveUpAt) return "unconfirmed";
        await sleep(input.pollMilliseconds ?? POLL_MILLISECONDS);
      }
    },
    contended: () => othersWaiting(directory, nonce, Date.now()).catch(() => false),
    preempted: () => {
      const now = Date.now();
      return othersWaiting(directory, nonce, now, now - PRIORITY_ADVANCE_MILLISECONDS / 2).catch(
        () => false,
      );
    },
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(renewal);
      // ADR-0576: contention delays the release instead of failing it. Once the lease has
      // lapsed, no reader treats the row as held, so the release is complete either way.
      const giveUpAt =
        input.releaseContentionWaitMilliseconds === undefined
          ? expiresAt
          : Math.min(expiresAt, Date.now() + input.releaseContentionWaitMilliseconds);
      for (;;) {
        try {
          await update(directory, "DELETE FROM holder WHERE slot=1 AND nonce=?", nonce);
          return;
        } catch (error) {
          if (!isSqliteLockContention(error)) throw identifiedFailure(error);
          if (Date.now() >= giveUpAt) return;
        }
        await sleep(input.pollMilliseconds ?? POLL_MILLISECONDS);
      }
    },
  };
}
