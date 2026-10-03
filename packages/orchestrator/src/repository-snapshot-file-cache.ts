import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  captureRepositorySnapshotIncrementally,
  defaultRepositorySnapshotPolicy,
  type RepositorySnapshot,
  type RepositorySnapshotCacheState,
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
 */
export async function capturePersistentRepositorySnapshot(
  repositoryRoot: string,
  cachePath: string,
  policy: RepositorySnapshotPolicy = defaultRepositorySnapshotPolicy,
): Promise<RepositorySnapshot> {
  let previous: RepositorySnapshotCacheState | undefined;
  try {
    const value: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (validCache(value)) previous = value;
  } catch {
    previous = undefined;
  }
  const { snapshot, cache } = await captureRepositorySnapshotIncrementally({
    repositoryRoot,
    policy,
    ...(previous === undefined ? {} : { previous }),
  });
  try {
    await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(cache), { mode: 0o600 });
    await rename(temporary, cachePath);
  } catch {
    // The cache is an optimization; failing to persist it never fails the capture.
  }
  return snapshot;
}
