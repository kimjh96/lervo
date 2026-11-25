import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  captureRepositorySnapshotIncrementally,
  defaultRepositorySnapshotPolicy,
  partialRepositorySnapshotCache,
  type RepositorySnapshot,
  type RepositorySnapshotCacheState,
  type RepositorySnapshotFileReader,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

function validCache(value: unknown): value is RepositorySnapshotCacheState {
  const cache = value as RepositorySnapshotCacheState | null;
  return (
    cache !== null &&
    typeof cache === "object" &&
    cache.schemaVersion === 1 &&
    typeof cache.cacheKey === "string" &&
    Array.isArray(cache.entries) &&
    cache.entries.every(
      (item) =>
        Array.isArray(item) &&
        typeof item[0] === "string" &&
        item[1] !== null &&
        typeof item[1] === "object" &&
        (item[1].kind === "file" || item[1].kind === "symlink") &&
        typeof item[1].identity === "string" &&
        HASH.test(item[1].hash) &&
        Number.isSafeInteger(item[1].byteLength),
    )
  );
}

/**
 * Hook processes are short-lived, so the in-memory stat cache never survived between prompts.
 * Persisting it lets each capture rehash only files whose stat identity changed. A missing or
 * invalid cache yields an ordinary full capture; the cache never changes snapshot semantics.
 *
 * A capture that runs out of time still persists the hashes it computed. Without that, a cold
 * cache in a checkout that cannot be hashed within one deadline, such as a fresh worktree of a
 * large repository, would never warm, and every capture there would fail the same way.
 */
export async function capturePersistentRepositorySnapshot(
  repositoryRoot: string,
  cachePath: string,
  policy: RepositorySnapshotPolicy = defaultRepositorySnapshotPolicy,
  fileReader?: RepositorySnapshotFileReader,
): Promise<RepositorySnapshot> {
  let previous: RepositorySnapshotCacheState | undefined;
  try {
    const value: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (validCache(value)) previous = value;
  } catch {
    previous = undefined;
  }
  let captured: { snapshot: RepositorySnapshot; cache: RepositorySnapshotCacheState };
  try {
    captured = await captureRepositorySnapshotIncrementally({
      repositoryRoot,
      policy,
      ...(previous === undefined ? {} : { previous }),
      ...(fileReader === undefined ? {} : { readFile: fileReader }),
    });
  } catch (error) {
    const partial = partialRepositorySnapshotCache(error);
    if (partial !== undefined) await persistCache(cachePath, partial);
    throw error;
  }
  await persistCache(cachePath, captured.cache);
  return captured.snapshot;
}

async function persistCache(cachePath: string, cache: RepositorySnapshotCacheState): Promise<void> {
  // Unique per write: two captures in one process, such as a resident's health refresh and its
  // detached knowledge scan, must not interleave into one temporary file.
  const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(cache), { mode: 0o600 });
    await rename(temporary, cachePath);
  } catch {
    // The cache is an optimization; failing to persist it never fails the capture.
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
