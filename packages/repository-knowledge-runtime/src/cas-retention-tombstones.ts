// ADR-0658: a pruned object leaves a small tombstone so the CAS reports it as pruned, never as
// missing or corrupt. Tombstones live under the CAS root, outside the object shards and the
// reference walk, and expire after a horizon because readers treat pruned and absent alike.
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** After this, a tombstone only tells a reader what `not_found` already does. */
export const TOMBSTONE_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
/** Tombstone entries one completed pass may inspect while expiring old ones. */
const EXPIRY_INSPECTIONS = 4096;

/** `packages/cas/src/cas.ts` reads the same layout. */
export function casTombstonePath(casRoot: string, hash: string): string {
  return resolve(casRoot, "tombstones", "sha256", hash.slice(0, 2), hash.slice(2));
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Writes the tombstone whole and durably: the file, its rename, and every directory entry that
 * `mkdir` created on the way, so a crash never leaves an unlinked object without its tombstone.
 */
export async function recordTombstone(casRoot: string, hash: string, size: number): Promise<void> {
  const target = casTombstonePath(casRoot, hash);
  const created = await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({ schemaVersion: 1, prunedAt: new Date().toISOString(), size, policy: "convergence_artifact_retention" })}\n`,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  // The new entry lives in its parent; each directory mkdir created lives in the one above it.
  for (let directory = dirname(target); ; directory = dirname(directory)) {
    await syncDirectory(directory);
    if (created === undefined || directory === dirname(created) || directory === casRoot) break;
  }
}

/** Withdraws a tombstone whose object stays, so the object never reads as pruned later. */
export async function withdrawTombstone(casRoot: string, hash: string): Promise<void> {
  await unlink(casTombstonePath(casRoot, hash)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/** Removes tombstones older than the horizon, inspecting a bounded number of entries per call. */
export async function expireTombstones(casRoot: string, now: number): Promise<number> {
  const root = resolve(casRoot, "tombstones", "sha256");
  let inspected = 0;
  let removed = 0;
  const shards = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const shard of shards) {
    if (!/^[a-f0-9]{2}$/u.test(shard.name) || !shard.isDirectory()) continue;
    for (const entry of await readdir(resolve(root, shard.name), { withFileTypes: true })) {
      if (++inspected > EXPIRY_INSPECTIONS) return removed;
      if (!entry.isFile() || !/^[a-f0-9]{62}$/u.test(entry.name)) continue;
      const path = resolve(root, shard.name, entry.name);
      if (now - (await lstat(path)).mtimeMs < TOMBSTONE_HORIZON_MS) continue;
      await unlink(path).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}
