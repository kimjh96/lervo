// The capture's stat-identity cache across captures: serialized for short-lived processes, or kept
// in memory by one long-lived capture function.
import { readRepositoryFile } from "@lervo/context";

import {
  captureRepositorySnapshotWithCache,
  defaultRepositorySnapshotPolicy,
  partialSnapshotCaptureState,
  type CachedSnapshotEntry,
  type CaptureRepositorySnapshot,
  type RepositorySnapshot,
  type RepositorySnapshotFileReader,
  type RepositorySnapshotPolicy,
  type SnapshotCaptureState,
} from "./repository-snapshot.js";

/** Serializable stat-identity cache, so short-lived processes reuse unchanged file hashes. */
export interface RepositorySnapshotCacheState {
  schemaVersion: 1;
  cacheKey: string;
  entries: [string, CachedSnapshotEntry][];
  /** The paths Git ignored at that capture; absent in a cache written before it was kept. */
  ignoredPaths?: string[];
}

/** The cache a capture that ran out of time had built, so its caller can keep the progress. */
export function partialRepositorySnapshotCache(
  error: unknown,
): RepositorySnapshotCacheState | undefined {
  const state = partialSnapshotCaptureState(error);
  return state === undefined
    ? undefined
    : { schemaVersion: 1, cacheKey: state.cacheKey, entries: [...state.entries] };
}

export async function captureRepositorySnapshotIncrementally(input: {
  repositoryRoot: string;
  previous?: RepositorySnapshotCacheState;
  policy?: RepositorySnapshotPolicy;
  readFile?: RepositorySnapshotFileReader;
}): Promise<{ snapshot: RepositorySnapshot; cache: RepositorySnapshotCacheState }> {
  const result = await captureRepositorySnapshotWithCache({
    repositoryRoot: input.repositoryRoot,
    policy: input.policy ?? defaultRepositorySnapshotPolicy,
    previous:
      input.previous === undefined
        ? undefined
        : {
            cacheKey: input.previous.cacheKey,
            entries: new Map(input.previous.entries),
            ...(input.previous.ignoredPaths === undefined
              ? {}
              : { ignoredPaths: new Set(input.previous.ignoredPaths) }),
          },
    readFile: input.readFile ?? readRepositoryFile,
  });
  return {
    snapshot: result.snapshot,
    cache: {
      schemaVersion: 1,
      cacheKey: result.state.cacheKey,
      entries: [...result.state.entries],
      ...(result.state.ignoredPaths === undefined
        ? {}
        : { ignoredPaths: [...result.state.ignoredPaths] }),
    },
  };
}

export function createCachedRepositorySnapshotCapture(input?: {
  readFile?: RepositorySnapshotFileReader;
}): CaptureRepositorySnapshot {
  const readFile = input?.readFile ?? readRepositoryFile;
  let state: SnapshotCaptureState | undefined;
  let pending: Promise<void> = Promise.resolve();
  return async (repositoryRoot, policy = defaultRepositorySnapshotPolicy) => {
    let release: () => void = () => undefined;
    const predecessor = pending;
    pending = new Promise<void>((resolvePending) => {
      release = resolvePending;
    });
    await predecessor;
    try {
      const result = await captureRepositorySnapshotWithCache({
        repositoryRoot,
        policy,
        previous: state,
        readFile,
      });
      state = result.state;
      return result.snapshot;
    } finally {
      release();
    }
  };
}
