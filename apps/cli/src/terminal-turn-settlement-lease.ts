// The single-flight lease of the turn settlement worker, its launch from hooks, and the requests it
// drops without a record (event schema 12; context, reference, and turn evidence, "Turns that end
// without a Stop hook"). One worker runs at a time, so a request that keeps failing never stacks
// workers, and every drop is counted by reason.
import { constants } from "node:fs";
import { open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { launchDetachedKnowledgeWorker } from "./detached-knowledge-worker.js";
import {
  hasTerminalTurnSettlements,
  MAXIMUM_SETTLEMENT_ATTEMPTS,
  removeTerminalTurnSettlement,
  rewriteTerminalTurnSettlement,
  terminalTurnSettlementDirectory,
  type TerminalTurnSettlementRequest,
} from "./terminal-turn-settlement.js";

const LEASE = ".worker-lease.json";
const DROPS = ".drops.json";
/** A lease older than this belongs to a worker that died without releasing it. */
const LEASE_MAXIMUM_AGE_MS = 10 * 60 * 1000;

/** Why a request was dropped without a record, as `.drops.json` counts them. */
export type TerminalTurnSettlementDrop = "writer_below_schema_12" | "attempts_exhausted";

/**
 * Starts the detached worker when any request waits, from the hook runtime only. A prompt, a
 * session start, and a Stop each call it, so a request whose worker never ran is picked up later.
 */
export async function launchTerminalTurnSettlements(
  root: string,
  executionRoot: string,
): Promise<boolean> {
  const entry = process.env.LERVO_TERMINAL_HOOK_RUNTIME;
  if (entry === undefined || !(await hasTerminalTurnSettlements(root))) return false;
  if (await liveSettlementLease(root, new Date())) return false;
  return launchDetachedKnowledgeWorker({ root: executionRoot, entry, args: ["settle-turns"] });
}

interface SettlementLease {
  pid: number;
  startedAt: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLease(directory: string): Promise<SettlementLease | null> {
  try {
    const value = JSON.parse(await readFile(resolve(directory, LEASE), "utf8")) as SettlementLease;
    return Number.isSafeInteger(value.pid) && Number.isFinite(Date.parse(value.startedAt))
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Whether a worker holds the lease: its process runs and the lease is not too old. */
async function liveSettlementLease(root: string, now: Date): Promise<boolean> {
  try {
    const lease = await readLease(await terminalTurnSettlementDirectory(root, false));
    return (
      lease !== null &&
      now.getTime() - Date.parse(lease.startedAt) < LEASE_MAXIMUM_AGE_MS &&
      processAlive(lease.pid)
    );
  } catch {
    return false;
  }
}

/**
 * Takes the single-flight lease for this process, or returns null when a live worker holds it. A
 * stale lease is replaced; of two workers replacing it at once, the exclusive create admits one.
 * The returned function releases the lease if it is still this process's.
 */
export async function acquireTerminalTurnSettlementLease(
  root: string,
  now = new Date(),
): Promise<(() => Promise<void>) | null> {
  try {
    const directory = await terminalTurnSettlementDirectory(root, true);
    const path = resolve(directory, LEASE);
    if (await liveSettlementLease(root, now)) return null;
    const stale = await readLease(directory);
    if (stale !== null) await rm(path, { force: true });
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, startedAt: now.toISOString() })}\n`,
      );
    } finally {
      await handle.close();
    }
    return async () => {
      if ((await readLease(directory))?.pid === process.pid) await rm(path, { force: true });
    };
  } catch {
    return null;
  }
}

/** Replaces `request` with one more failed attempt, or drops and counts it at the limit. */
export async function recordTerminalTurnSettlementFailure(
  root: string,
  request: TerminalTurnSettlementRequest,
): Promise<void> {
  const attempts = request.attempts + 1;
  if (attempts >= MAXIMUM_SETTLEMENT_ATTEMPTS) {
    await removeTerminalTurnSettlement(root, request.contextEventId);
    await countTerminalTurnSettlementDrops(root, "attempts_exhausted", 1);
    return;
  }
  await rewriteTerminalTurnSettlement(root, { ...request, attempts });
}

/** Requests dropped without a record, by reason, since the directory was created. */
export async function readTerminalTurnSettlementDrops(
  root: string,
): Promise<Record<TerminalTurnSettlementDrop, number>> {
  const empty = { writer_below_schema_12: 0, attempts_exhausted: 0 };
  try {
    const value = JSON.parse(
      await readFile(resolve(await terminalTurnSettlementDirectory(root, false), DROPS), "utf8"),
    ) as Partial<Record<TerminalTurnSettlementDrop, unknown>>;
    return {
      writer_below_schema_12: Number.isSafeInteger(value.writer_below_schema_12)
        ? Number(value.writer_below_schema_12)
        : 0,
      attempts_exhausted: Number.isSafeInteger(value.attempts_exhausted)
        ? Number(value.attempts_exhausted)
        : 0,
    };
  } catch {
    return empty;
  }
}

/** Adds `count` drops for `reason`. Only the lease holder writes, so updates do not race. */
export async function countTerminalTurnSettlementDrops(
  root: string,
  reason: TerminalTurnSettlementDrop,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  let temporary: string | undefined;
  try {
    const directory = await terminalTurnSettlementDirectory(root, true);
    const drops = await readTerminalTurnSettlementDrops(root);
    drops[reason] += count;
    temporary = resolve(directory, `.drops-${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(drops)}\n`);
    } finally {
      await handle.close();
    }
    await rename(temporary, resolve(directory, DROPS));
    temporary = undefined;
  } catch {
    /* A count is diagnostic only. */
  } finally {
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => undefined);
  }
}
