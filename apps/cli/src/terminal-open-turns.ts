import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import {
  newTranscriptStart,
  validTranscriptPosition,
  type TranscriptPosition,
} from "@lervo/repository-knowledge-runtime";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";

const MAXIMUM_MARKERS = 128;
const MAXIMUM_AGE_MS = 6 * 60 * 60 * 1000;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const EVENT = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

/** One fixed marker file per provider session, replaced atomically by each new prompt. */
function markerName(providerSessionDigest: string): string {
  return `ses_${providerSessionDigest.slice("sha256:".length)}.json`;
}

export interface OpenTerminalTurn {
  provider: TerminalIntegrationProvider;
  providerSessionDigest: string;
  providerTurnDigest: string | null;
  contextEventId: string;
  openedAt: string;
  transcript?: TranscriptPosition | null;
  /** The transcript path when the provider had not created it yet at this prompt. */
  transcriptAbsent?: string;
}

async function markerDirectory(root: string, create: boolean): Promise<string> {
  let directory = root;
  for (const segment of [".lervo", "state", "terminal-integration", "open-turns"]) {
    directory = resolve(directory, segment);
    if (create)
      await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Unsafe open-turn directory.");
  }
  return directory;
}

function isMarker(value: unknown): value is OpenTerminalTurn {
  if (value === null || typeof value !== "object") return false;
  const item = value as OpenTerminalTurn;
  return (
    (item.provider === "codex" || item.provider === "claude") &&
    HASH.test(item.providerSessionDigest) &&
    (item.providerTurnDigest === null || HASH.test(item.providerTurnDigest)) &&
    EVENT.test(item.contextEventId) &&
    (item.transcript === undefined ||
      item.transcript === null ||
      validTranscriptPosition(item.transcript)) &&
    (item.transcriptAbsent === undefined ||
      (typeof item.transcriptAbsent === "string" &&
        isAbsolute(item.transcriptAbsent) &&
        item.transcriptAbsent.length <= 4096 &&
        !item.transcriptAbsent.includes("\0"))) &&
    Number.isFinite(Date.parse(item.openedAt))
  );
}

async function readMarkers(root: string, now: Date): Promise<OpenTerminalTurn[] | null> {
  try {
    const directory = await markerDirectory(root, false);
    const entries = await opendir(directory);
    const markers: OpenTerminalTurn[] = [];
    let count = 0;
    for await (const entry of entries) {
      if (++count > MAXIMUM_MARKERS) return null;
      if (!/^ses_[a-f0-9]{64}\.json$/u.test(entry.name) || !entry.isFile()) return null;
      const path = resolve(directory, entry.name);
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let value: unknown;
      try {
        const bytes = Buffer.alloc(8193);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > 8192) return null;
        value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
      } finally {
        await handle.close();
      }
      if (!isMarker(value) || entry.name !== markerName(value.providerSessionDigest)) return null;
      if (now.getTime() - Date.parse(value.openedAt) > MAXIMUM_AGE_MS) {
        await rm(path, { force: true });
      } else markers.push(value);
    }
    return markers;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
  }
}

export async function singleOpenTerminalTurn(
  root: string,
  now = new Date(),
): Promise<OpenTerminalTurn | null> {
  const markers = await readMarkers(root, now);
  return markers?.length === 1 ? markers[0]! : null;
}

export async function openTerminalTurn(root: string, marker: OpenTerminalTurn): Promise<void> {
  let temporary: string | undefined;
  try {
    if (!isMarker(marker)) return;
    const directory = await markerDirectory(root, true);
    await readMarkers(root, new Date(marker.openedAt));
    temporary = resolve(
      root,
      ".lervo/state/terminal-integration",
      `.open-turn-${randomUUID()}.tmp`,
    );
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(marker)}\n`);
    } finally {
      await handle.close();
    }
    // A session has at most one open turn: an interrupted turn never reaches Stop, so the new
    // prompt's marker replaces the session file in one rename. A failed write keeps the old one.
    await rename(temporary, resolve(directory, markerName(marker.providerSessionDigest)));
  } catch {
    // Host-private observation must never change prompt preparation availability.
  } finally {
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => {});
  }
}

/**
 * The open turn an agent-run query belongs to. Claude Code gives every command it runs its own
 * session, so the query binds to that session's marker even while other sessions have turns open.
 * Without a provider session, it binds only when exactly one turn is open.
 */
export async function queryOpenTerminalTurn(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<OpenTerminalTurn | null> {
  const session = env.CLAUDE_CODE_SESSION_ID;
  if (session === undefined) return singleOpenTerminalTurn(root, now);
  // A named but unusable session never falls back to another session's single open turn.
  if (session.trim() === "" || session.length > 512) return null;
  const marker = await sessionOpenTerminalTurn(root, sha256(`claude\0${session}`), now);
  return marker?.provider === "claude" ? marker : null;
}

/** The open-turn marker of one session, or null when none exists or storage is unusable. */
export async function sessionOpenTerminalTurn(
  root: string,
  providerSessionDigest: string,
  now = new Date(),
): Promise<OpenTerminalTurn | null> {
  const markers = await readMarkers(root, now);
  return markers?.find((item) => item.providerSessionDigest === providerSessionDigest) ?? null;
}

/** Removes the session marker only while it still names the closing turn's context. */
export async function closeTerminalTurn(
  root: string,
  providerSessionDigest: string,
  contextEventId: string,
  now = new Date(),
): Promise<void> {
  try {
    if (!EVENT.test(contextEventId) || !HASH.test(providerSessionDigest)) return;
    const current = await sessionOpenTerminalTurn(root, providerSessionDigest, now);
    if (current?.contextEventId !== contextEventId) return;
    const directory = await markerDirectory(root, false);
    await rm(resolve(directory, markerName(providerSessionDigest)), { force: true });
  } catch {
    // Unavailable marker storage means no binding, never a failed Stop.
  }
}

export function openTurnCoordinates(marker: OpenTerminalTurn): UnmanagedTerminalCoordinates {
  const suffix = marker.providerSessionDigest.slice("sha256:".length, "sha256:".length + 24);
  return {
    runId: `run_unmanaged_${suffix}`,
    sessionId: `ses_unmanaged_${suffix}`,
    providerSessionDigest: marker.providerSessionDigest,
    providerTurnDigest: marker.providerTurnDigest,
  };
}

/**
 * Where the closing turn's transcript range starts: the position recorded at its prompt, or the
 * start of a transcript that did not exist at that prompt and now exists at the same path.
 */
export function openTurnTranscriptStart(
  marker: OpenTerminalTurn,
  end: TranscriptPosition | null,
  transcriptPath: string | undefined,
): TranscriptPosition | null {
  if (marker.transcript) return marker.transcript;
  if (
    marker.transcriptAbsent === undefined ||
    end === null ||
    transcriptPath === undefined ||
    resolve(transcriptPath) !== marker.transcriptAbsent
  )
    return null;
  return newTranscriptStart(end);
}
