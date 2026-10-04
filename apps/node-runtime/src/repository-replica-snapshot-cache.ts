import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertRepositoryReplicaSnapshot,
  calculateRepositoryReplicaSnapshotHash,
  type RepositoryReplicaSnapshot,
} from "@lervo/sync";

import {
  observeRepositoryReplicaFingerprint,
  type ObservedFingerprint,
} from "./repository-replica-fingerprint.js";
import { captureRepositoryReplicaSnapshot } from "./repository-replica-git.js";

const CACHE_DIRECTORY = "lervo-replica";
const CACHE_FILE = "snapshot-cache.json";

interface SnapshotCacheRecord {
  schemaVersion: 1;
  fingerprint: string;
  snapshot: RepositoryReplicaSnapshot;
}

function cachePath(gitDirectory: string): string {
  return join(gitDirectory, CACHE_DIRECTORY, CACHE_FILE);
}

async function readCachedSnapshot(
  observed: ObservedFingerprint,
): Promise<RepositoryReplicaSnapshot | null> {
  try {
    const record = JSON.parse(
      await readFile(cachePath(observed.gitDirectory), "utf8"),
    ) as Partial<SnapshotCacheRecord> | null;
    if (
      record === null ||
      typeof record !== "object" ||
      record.schemaVersion !== 1 ||
      record.fingerprint !== observed.fingerprint ||
      record.snapshot === undefined
    )
      return null;
    const snapshot = record.snapshot;
    assertRepositoryReplicaSnapshot(snapshot);
    const { snapshotHash, ...source } = snapshot;
    if (
      calculateRepositoryReplicaSnapshotHash(source) !== snapshotHash ||
      snapshot.head !== observed.head ||
      snapshot.branch !== observed.branch
    )
      return null;
    return snapshot;
  } catch {
    // A missing, unreadable, or invalid projection only means the snapshot is captured again.
    return null;
  }
}

async function writeCachedSnapshot(
  gitDirectory: string,
  record: SnapshotCacheRecord,
): Promise<void> {
  const path = cachePath(gitDirectory);
  await mkdir(join(gitDirectory, CACHE_DIRECTORY), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.next`;
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/**
 * Observation-only snapshot: returns the cached snapshot when the repository fingerprint is
 * unchanged and otherwise captures it. A capture is cached only when the fingerprint was equal
 * before and after it and no observed timestamp was racy. Bundle, apply, merge, and readiness
 * admission always capture freshly; this function never authorizes mutation.
 */
export async function observeRepositoryReplicaSnapshot(
  repositoryRoot: string,
  options: { nowMilliseconds?: () => number } = {},
): Promise<RepositoryReplicaSnapshot> {
  let before: ObservedFingerprint | null;
  try {
    before = await observeRepositoryReplicaFingerprint(repositoryRoot, options.nowMilliseconds);
  } catch {
    // The fresh capture reports any repository failure with its own stage and Git evidence.
    before = null;
  }
  if (before?.cacheable === true) {
    const cached = await readCachedSnapshot(before);
    if (cached !== null) return cached;
  }
  const snapshot = await captureRepositoryReplicaSnapshot(repositoryRoot);
  if (before === null || !before.cacheable) return snapshot;
  try {
    const after = await observeRepositoryReplicaFingerprint(
      repositoryRoot,
      options.nowMilliseconds,
    );
    if (
      after.cacheable &&
      after.fingerprint === before.fingerprint &&
      snapshot.head === after.head &&
      snapshot.branch === after.branch
    ) {
      await writeCachedSnapshot(after.gitDirectory, {
        schemaVersion: 1,
        fingerprint: after.fingerprint,
        snapshot,
      });
    }
  } catch {
    // The cache is a rebuildable projection; the captured snapshot remains authoritative.
  }
  return snapshot;
}
