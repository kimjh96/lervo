import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  validTranscriptPosition,
  type TranscriptPosition,
} from "./terminal-transcript-position.js";
export {
  terminalTranscriptPosition,
  validTranscriptPosition,
  type TranscriptPosition,
} from "./terminal-transcript-position.js";

export const TERMINAL_SKILL_QUEUE = ".lervo/state/knowledge/terminal-skills/queue";
const RETENTION_MS = 24 * 3_600_000;
const MAXIMUM_RECORDS = 128;
const MAXIMUM_RECORD_BYTES = 12 * 1024;
const EVENT = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface QueuedTerminalSkillTurn {
  provider: "claude" | "codex";
  providerSessionDigest: string;
  providerTurnDigest: string | null;
  contextEventId: string;
  turnEventId: string;
  start: TranscriptPosition | null;
  end: TranscriptPosition | null;
  enqueuedAt: string;
  repositoryRevision: string | null;
}

async function directory(root: string, create: boolean): Promise<string> {
  let path = resolve(root);
  for (const part of TERMINAL_SKILL_QUEUE.split("/")) {
    path = resolve(path, part);
    if (create)
      await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Unsafe skill queue directory.");
  }
  return path;
}

function validRecord(value: unknown): value is QueuedTerminalSkillTurn {
  const item = value as QueuedTerminalSkillTurn | null;
  return (
    item !== null &&
    typeof item === "object" &&
    (item.provider === "claude" || item.provider === "codex") &&
    HASH.test(item.providerSessionDigest) &&
    (item.providerTurnDigest === null || HASH.test(item.providerTurnDigest)) &&
    EVENT.test(item.contextEventId) &&
    EVENT.test(item.turnEventId) &&
    (item.repositoryRevision === null ||
      (typeof item.repositoryRevision === "string" &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(item.repositoryRevision))) &&
    (item.start === null || validTranscriptPosition(item.start)) &&
    (item.end === null || validTranscriptPosition(item.end)) &&
    typeof item.enqueuedAt === "string" &&
    Number.isFinite(Date.parse(item.enqueuedAt))
  );
}

/** Expired and malformed records are deleted, including after an interrupted resident. */
export async function queuedTerminalSkillTurns(
  root: string,
  now: Date,
): Promise<QueuedTerminalSkillTurn[]> {
  let base: string;
  try {
    base = await directory(root, false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: QueuedTerminalSkillTurn[] = [];
  for (const name of (await readdir(base)).sort()) {
    if (/^\.[a-f0-9-]+\.tmp$/u.test(name)) {
      const path = resolve(base, name);
      const metadata = await lstat(path).catch(() => null);
      if (metadata !== null && now.getTime() - metadata.mtimeMs >= RETENTION_MS)
        await rm(path, { force: true });
      continue;
    }
    if (!/^evt_[A-Za-z0-9_-]+\.json$/u.test(name)) continue;
    const path = resolve(base, name);
    let value: unknown = null;
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK,
      );
      try {
        const metadata = await handle.stat();
        if (metadata.isFile() && metadata.size <= MAXIMUM_RECORD_BYTES) {
          const bytes = Buffer.alloc(MAXIMUM_RECORD_BYTES + 1);
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
          if (bytesRead <= MAXIMUM_RECORD_BYTES)
            value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
        }
      } finally {
        await handle.close();
      }
    } catch {
      /* Invalid local queue data provides no evidence. */
    }
    // A producer can finish after the resident captured `now`. Leave future records untouched.
    if (validRecord(value) && Date.parse(value.enqueuedAt) > now.getTime()) continue;
    const metadata = await lstat(path).catch(() => null);
    if (metadata !== null && metadata.mtimeMs > now.getTime()) continue;
    if (
      validRecord(value) &&
      name === `${value.contextEventId}.json` &&
      now.getTime() >= Date.parse(value.enqueuedAt) &&
      now.getTime() - Date.parse(value.enqueuedAt) < RETENTION_MS
    )
      result.push(value);
    else {
      const metadata = await lstat(path).catch(() => null);
      if (metadata !== null && metadata.mtimeMs <= now.getTime()) await rm(path, { force: true });
    }
  }
  result.sort(
    (a, b) =>
      a.enqueuedAt.localeCompare(b.enqueuedAt) || a.contextEventId.localeCompare(b.contextEventId),
  );
  for (const item of result.splice(0, Math.max(0, result.length - MAXIMUM_RECORDS)))
    await removeTerminalSkillTurn(root, item.contextEventId);
  return result;
}

export async function removeTerminalSkillTurn(root: string, contextEventId: string): Promise<void> {
  if (!EVENT.test(contextEventId)) return;
  await rm(resolve(await directory(root, false), `${contextEventId}.json`), { force: true });
}

/** Best effort hook ingress; paths and offsets stay in private, ignored state for at most a day. */
export async function enqueueTerminalSkillTurn(
  root: string,
  record: QueuedTerminalSkillTurn,
): Promise<void> {
  let temporary: string | undefined;
  try {
    if (!validRecord(record)) return;
    const base = await directory(root, true);
    temporary = resolve(base, `.${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`);
    } finally {
      await handle.close();
    }
    // Atomic publish without replacement. A concurrent duplicate cannot rewrite a queued turn.
    await link(temporary, resolve(base, `${record.contextEventId}.json`));
  } catch {
    /* Skill telemetry cannot fail Stop. */
  } finally {
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
  }
}
