// Turns that end without a Stop hook (event schema 12; context, reference, and turn evidence,
// "Turns that end without a Stop hook"). Claude runs no Stop hook for an interrupted turn, so a
// hook that finds the same session's open turn still open writes a settlement request here, and a
// detached worker records the turn. Requests are idempotent by the turn's context event, bounded as
// open-turn markers are, and hold the session only as its digest. The worker's lease and drop counts
// live in `terminal-turn-settlement-lease.ts`.
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import {
  validTranscriptPosition,
  type TranscriptPosition,
} from "@lervo/repository-knowledge-runtime";

import { sessionOpenTerminalTurn } from "./terminal-open-turns.js";

const MAXIMUM_REQUESTS = 128;
const MAXIMUM_AGE_MS = 6 * 60 * 60 * 1000;
const MAXIMUM_REQUEST_BYTES = 16 * 1024;
const EVENT = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const OBSERVATION = /^tobs_[a-f0-9]{32}$/u;
const NAME = /^set_[a-f0-9]{64}\.json$/u;
/** Failed attempts after which a request is dropped and counted instead of retried. */
export const MAXIMUM_SETTLEMENT_ATTEMPTS = 3;

/** How a settled turn ended, as `terminal.turn.observed` names it at schema 12. */
export type TerminalTurnSettlementEnding = "next_prompt" | "session_start";

export interface TerminalTurnSettlementRequest {
  schemaVersion: 1;
  provider: TerminalIntegrationProvider;
  providerSessionDigest: string;
  contextEventId: string;
  ending: TerminalTurnSettlementEnding;
  /** The checkout the turn worked in; a linked worktree differs from the repository. */
  executionRoot: string;
  /** The prepared snapshot of the prompt that settles the turn; null captures one at settlement. */
  afterObservationId: string | null;
  transcriptStart: TranscriptPosition | null;
  transcriptEnd: TranscriptPosition | null;
  requestedAt: string;
  /** Worker attempts that failed so far. */
  attempts: number;
}

/** The event that records a settled turn: one per turn, so two settlements record once. */
export function settledTerminalTurnEventId(contextEventId: string): string {
  return `evt_${sha256(`settled:${contextEventId}`).slice("sha256:".length, "sha256:".length + 32)}`;
}

/** The digest an open-turn marker keeps of the checkout its turn worked in. */
export function terminalExecutionRootDigest(executionRoot: string): string {
  return sha256(resolve(executionRoot));
}

function requestName(contextEventId: string): string {
  return `set_${sha256(contextEventId).slice("sha256:".length)}.json`;
}

export async function terminalTurnSettlementDirectory(
  root: string,
  create: boolean,
): Promise<string> {
  let directory = root;
  for (const segment of [".lervo", "state", "terminal-integration", "turn-settlements"]) {
    directory = resolve(directory, segment);
    if (create)
      await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Unsafe turn settlement directory.");
  }
  return directory;
}

function isRequest(value: unknown): value is TerminalTurnSettlementRequest {
  if (value === null || typeof value !== "object") return false;
  const item = value as TerminalTurnSettlementRequest;
  const position = (candidate: unknown) => candidate === null || validTranscriptPosition(candidate);
  return (
    item.schemaVersion === 1 &&
    (item.provider === "claude" || item.provider === "codex") &&
    HASH.test(item.providerSessionDigest) &&
    EVENT.test(item.contextEventId) &&
    (item.ending === "next_prompt" || item.ending === "session_start") &&
    typeof item.executionRoot === "string" &&
    isAbsolute(item.executionRoot) &&
    item.executionRoot.length <= 4096 &&
    !item.executionRoot.includes("\0") &&
    (item.afterObservationId === null || OBSERVATION.test(item.afterObservationId)) &&
    position(item.transcriptStart) &&
    position(item.transcriptEnd) &&
    Number.isFinite(Date.parse(item.requestedAt)) &&
    Number.isSafeInteger(item.attempts) &&
    item.attempts >= 0 &&
    item.attempts < MAXIMUM_SETTLEMENT_ATTEMPTS
  );
}

/**
 * The pending requests, oldest first. Expired ones are removed; an unsafe or unreadable directory
 * reads as empty, so a hook never fails on it.
 */
export async function listTerminalTurnSettlements(
  root: string,
  now = new Date(),
): Promise<TerminalTurnSettlementRequest[]> {
  try {
    const directory = await terminalTurnSettlementDirectory(root, false);
    const requests: TerminalTurnSettlementRequest[] = [];
    let count = 0;
    for await (const entry of await opendir(directory)) {
      if (!NAME.test(entry.name) || !entry.isFile()) continue;
      if (++count > MAXIMUM_REQUESTS) break;
      const path = resolve(directory, entry.name);
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let value: unknown;
      try {
        const bytes = Buffer.alloc(MAXIMUM_REQUEST_BYTES + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        value =
          bytesRead > MAXIMUM_REQUEST_BYTES
            ? null
            : JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
      } catch {
        value = null;
      } finally {
        await handle.close();
      }
      if (!isRequest(value) || entry.name !== requestName(value.contextEventId)) {
        await rm(path, { force: true });
        continue;
      }
      if (now.getTime() - Date.parse(value.requestedAt) > MAXIMUM_AGE_MS)
        await rm(path, { force: true });
      else requests.push(value);
    }
    return requests.sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  } catch {
    return [];
  }
}

/** Whether any request waits, without reading them: a hook checks this before launching a worker. */
export async function hasTerminalTurnSettlements(root: string): Promise<boolean> {
  try {
    const directory = await terminalTurnSettlementDirectory(root, false);
    for await (const entry of await opendir(directory)) if (NAME.test(entry.name)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Writes `request` unless one for the same turn exists or the directory is full. Returns whether a
 * request now waits for the turn.
 */
export async function writeTerminalTurnSettlement(
  root: string,
  request: TerminalTurnSettlementRequest,
): Promise<boolean> {
  if (!isRequest(request)) return false;
  let temporary: string | undefined;
  try {
    const directory = await terminalTurnSettlementDirectory(root, true);
    const target = resolve(directory, requestName(request.contextEventId));
    let count = 0;
    for await (const entry of await opendir(directory)) {
      if (entry.name === requestName(request.contextEventId)) return true;
      if (NAME.test(entry.name)) count += 1;
    }
    if (count >= MAXIMUM_REQUESTS) return false;
    temporary = resolve(directory, `.settlement-${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(request)}\n`);
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    temporary = undefined;
    return true;
  } catch {
    return false;
  } finally {
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function removeTerminalTurnSettlement(
  root: string,
  contextEventId: string,
): Promise<void> {
  try {
    const directory = await terminalTurnSettlementDirectory(root, false);
    await rm(resolve(directory, requestName(contextEventId)), { force: true });
  } catch {
    /* A request that stays is retried and then expires. */
  }
}

/**
 * Requests the settlement of the same session's turn that is still open, when a new prompt or a
 * session start replaces it. Only a marker of this session in this checkout counts; a marker from
 * before checkouts were recorded counts for any checkout. Cheap by design: whether the turn was
 * already observed is the worker's question, not the hook's.
 */
export async function requestOpenTerminalTurnSettlement(input: {
  root: string;
  executionRoot: string;
  provider: TerminalIntegrationProvider;
  providerSessionDigest: string;
  ending: TerminalTurnSettlementEnding;
  afterObservationId: string | null;
  transcriptEnd: TranscriptPosition | null;
  now: Date;
}): Promise<boolean> {
  const marker = await sessionOpenTerminalTurn(input.root, input.providerSessionDigest, input.now);
  if (marker === null || marker.provider !== input.provider) return false;
  if (
    marker.executionRootDigest !== undefined &&
    marker.executionRootDigest !== terminalExecutionRootDigest(input.executionRoot)
  )
    return false;
  return writeTerminalTurnSettlement(input.root, {
    schemaVersion: 1,
    provider: input.provider,
    providerSessionDigest: input.providerSessionDigest,
    contextEventId: marker.contextEventId,
    ending: input.ending,
    executionRoot: resolve(input.executionRoot),
    afterObservationId: input.afterObservationId,
    transcriptStart: marker.transcript ?? null,
    transcriptEnd: input.transcriptEnd,
    requestedAt: input.now.toISOString(),
    attempts: 0,
  });
}

/** Replaces the stored request for the same turn, as a failed attempt does. */
export async function rewriteTerminalTurnSettlement(
  root: string,
  request: TerminalTurnSettlementRequest,
): Promise<void> {
  if (!isRequest(request)) return;
  let temporary: string | undefined;
  try {
    const directory = await terminalTurnSettlementDirectory(root, false);
    temporary = resolve(directory, `.settlement-${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(request)}\n`);
    } finally {
      await handle.close();
    }
    await rename(temporary, resolve(directory, requestName(request.contextEventId)));
    temporary = undefined;
  } catch {
    /* The request stays as it was; it still expires. */
  } finally {
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => undefined);
  }
}
