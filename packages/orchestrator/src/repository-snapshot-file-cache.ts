import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import {
  defaultRepositorySnapshotPolicy,
  type RepositorySnapshot,
  type RepositorySnapshotFileReader,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot.js";
import {
  captureRepositorySnapshotIncrementally,
  partialRepositorySnapshotCache,
  type RepositorySnapshotCacheState,
} from "./repository-snapshot-cache.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

/** A path inside the repository, as Git lists it: relative, without `..` or a NUL byte. */
function repositoryRelativePath(path: unknown): boolean {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\0") &&
    !path.split("/").includes("..")
  );
}

function validCache(value: unknown): value is RepositorySnapshotCacheState {
  const cache = value as RepositorySnapshotCacheState | null;
  return (
    cache !== null &&
    typeof cache === "object" &&
    cache.schemaVersion === 1 &&
    typeof cache.cacheKey === "string" &&
    Array.isArray(cache.entries) &&
    (cache.ignoredPaths === undefined ||
      (Array.isArray(cache.ignoredPaths) && cache.ignoredPaths.every(repositoryRelativePath))) &&
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
  let previous = await rememberedCache(cachePath);
  if (previous === undefined) {
    try {
      const value: unknown = JSON.parse(await readFile(cachePath, "utf8"));
      if (validCache(value)) previous = value;
    } catch {
      previous = undefined;
    }
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

/**
 * The cache this process last wrote, by path, with the written file's identity. A long-lived
 * process, such as the context server, then reuses it instead of reading and checking its own
 * 2.4 MB file again on every prompt. Any other writer replaces the file, which changes its identity,
 * so the file is read again.
 */
const written = new Map<string, { identity: string; cache: RepositorySnapshotCacheState }>();
const REMEMBERED_CACHE_LIMIT = 8;

function fileIdentity(stats: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint }): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
}

async function rememberedCache(
  cachePath: string,
): Promise<RepositorySnapshotCacheState | undefined> {
  const remembered = written.get(cachePath);
  if (remembered === undefined) return undefined;
  const stats = await lstat(cachePath, { bigint: true }).catch(() => null);
  return stats !== null && stats.isFile() && fileIdentity(stats) === remembered.identity
    ? remembered.cache
    : undefined;
}

async function persistCache(cachePath: string, cache: RepositorySnapshotCacheState): Promise<void> {
  // Unique per write: two captures in one process, such as a resident's health refresh and its
  // detached knowledge scan, must not interleave into one temporary file.
  const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  written.delete(cachePath);
  try {
    await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
    const handle = await open(temporary, "w", 0o600);
    let identity: string;
    try {
      await handle.writeFile(JSON.stringify(cache));
      // The identity of these bytes, which a rename keeps.
      identity = fileIdentity(await handle.stat({ bigint: true }));
    } finally {
      await handle.close();
    }
    await rename(temporary, cachePath);
    if (written.size >= REMEMBERED_CACHE_LIMIT) written.delete(written.keys().next().value!);
    written.set(cachePath, { identity, cache });
  } catch {
    // The cache is an optimization; failing to persist it never fails the capture.
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
