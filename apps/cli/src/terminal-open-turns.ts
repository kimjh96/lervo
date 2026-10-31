import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";

const MAXIMUM_MARKERS = 128;
const MAXIMUM_AGE_MS = 6 * 60 * 60 * 1000;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const EVENT = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export interface OpenTerminalTurn {
  provider: TerminalIntegrationProvider;
  providerSessionDigest: string;
  providerTurnDigest: string | null;
  contextEventId: string;
  openedAt: string;
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
      if (!/^evt_[A-Za-z0-9_-]+\.json$/u.test(entry.name) || !entry.isFile()) return null;
      const path = resolve(directory, entry.name);
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let value: unknown;
      try {
        const bytes = Buffer.alloc(2049);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > 2048) return null;
        value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
      } finally {
        await handle.close();
      }
      if (!isMarker(value) || entry.name !== `${value.contextEventId}.json`) return null;
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
    // A session has at most one open turn: an interrupted turn never reaches Stop, so a new
    // prompt in the same session replaces its marker instead of making the binding ambiguous.
    for (const previous of (await readMarkers(root, new Date(marker.openedAt))) ?? [])
      if (previous.providerSessionDigest === marker.providerSessionDigest)
        await rm(resolve(directory, `${previous.contextEventId}.json`), { force: true });
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
    await rename(temporary, resolve(directory, `${marker.contextEventId}.json`));
  } catch {
    // Host-private observation must never change prompt preparation availability.
  } finally {
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function closeTerminalTurn(
  root: string,
  contextEventId: string,
  now = new Date(),
): Promise<void> {
  try {
    if (!EVENT.test(contextEventId)) return;
    const directory = await markerDirectory(root, false);
    await rm(resolve(directory, `${contextEventId}.json`), { force: true });
    await readMarkers(root, now);
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
