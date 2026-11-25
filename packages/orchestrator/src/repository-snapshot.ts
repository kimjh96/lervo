import {
  defaultRepositorySnapshotPolicy,
  resolveRepositorySnapshotPolicy,
  RepositorySnapshotError,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot-policy.js";
export {
  defaultRepositorySnapshotPolicy,
  resolveRepositorySnapshotPolicy,
  RepositorySnapshotError,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot-policy.js";
import {
  repositorySnapshotGitHead,
  repositorySnapshotGitIgnoredPaths,
} from "./repository-snapshot-git.js";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { readRepositoryFile } from "@lervo/context";

export interface RepositorySnapshot {
  revision: string;
  files: Readonly<Record<string, string>>;
  commits?: Readonly<Record<string, string>>;
}

export type CaptureRepositorySnapshot = (
  repositoryRoot: string,
  policy?: RepositorySnapshotPolicy,
) => Promise<RepositorySnapshot>;

export type RepositorySnapshotFileReader = typeof readRepositoryFile;

export interface CachedSnapshotEntry {
  kind: "file" | "symlink";
  identity: string;
  hash: string;
  byteLength: number;
}

/**
 * The entries a capture had hashed when its deadline ran out, with any earlier entries it had not
 * reached yet, so a persisted cache keeps warming across captures that each stop at a deadline.
 */
const partialStates = new WeakMap<RepositorySnapshotError, SnapshotCaptureState>();

interface SnapshotCaptureState {
  cacheKey: string;
  entries: ReadonlyMap<string, CachedSnapshotEntry>;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Files a capture reads at once. A read that is running when the deadline passes still finishes,
 * so this also bounds how long a rejection can lag the deadline on a slow disk.
 */
const SNAPSHOT_READ_CONCURRENCY = 8;
/** Stats, link reads, and directory reads a capture runs at once. */
const SNAPSHOT_STAT_CONCURRENCY = 64;

/** Runs at most `limit` of the given operations at a time, in the order they were asked for. */
function boundedConcurrency(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    // A finishing operation hands its slot straight to the next waiter, so a new caller arriving
    // in between never finds a slot that is already promised.
    if (running >= limit) await new Promise<void>((proceed) => waiting.push(proceed));
    else running += 1;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next === undefined) running -= 1;
      else next();
    }
  };
}

/** `localeCompare`'s order, from one collator instead of one per comparison (ECMA-402). */
const nameOrder = new Intl.Collator();

export async function captureRepositorySnapshot(
  repositoryRoot: string,
  policy: RepositorySnapshotPolicy = defaultRepositorySnapshotPolicy,
): Promise<RepositorySnapshot> {
  return captureRepositorySnapshotWithCache({
    repositoryRoot,
    policy,
    previous: undefined,
    readFile: readRepositoryFile,
  }).then((result) => result.snapshot);
}

function snapshotCacheKey(root: string, policy: RepositorySnapshotPolicy): string {
  return JSON.stringify([
    root,
    [...policy.excludedDirectoryNames].sort(),
    [...policy.excludedPaths].sort(),
  ]);
}

function entryIdentity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":");
}

async function captureRepositorySnapshotWithCache(input: {
  repositoryRoot: string;
  policy: RepositorySnapshotPolicy;
  previous: SnapshotCaptureState | undefined;
  readFile: RepositorySnapshotFileReader;
}): Promise<{ snapshot: RepositorySnapshot; state: SnapshotCaptureState }> {
  const resolvedPolicy = resolveRepositorySnapshotPolicy(input.policy);
  const checkDeadline = () => {
    if (resolvedPolicy.deadlineMs !== undefined && performance.now() >= resolvedPolicy.deadlineMs)
      throw new RepositorySnapshotError(
        "The repository snapshot deadline was exceeded.",
        undefined,
        "repository_snapshot_deadline_exceeded",
      );
  };
  checkDeadline();
  const [head, ignored] = await Promise.all([
    repositorySnapshotGitHead(input.repositoryRoot, resolvedPolicy.deadlineMs),
    repositorySnapshotGitIgnoredPaths(input.repositoryRoot, resolvedPolicy.deadlineMs),
  ]);
  checkDeadline();
  if (ignored.status === "unavailable")
    throw new RepositorySnapshotError(
      "Git ignored paths are unavailable.",
      undefined,
      "git_ignored_paths_unavailable",
    );
  const ignoredPaths = ignored.paths;
  const excludedDirectories = new Set(resolvedPolicy.excludedDirectoryNames);
  const excludedPaths = new Set(resolvedPolicy.excludedPaths);
  const root = resolve(input.repositoryRoot);
  const cacheKey = snapshotCacheKey(root, resolvedPolicy);
  const previousEntries =
    input.previous?.cacheKey === cacheKey ? input.previous.entries : new Map();
  const nextEntries = new Map<string, CachedSnapshotEntry>();
  try {
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("unsafe root");
  } catch {
    throw new RepositorySnapshotError("The repository snapshot root is not a safe real directory.");
  }
  let fileCount = 0;
  let byteCount = 0;
  // The first failure stops the whole walk: no branch starts another stat or read after it, and
  // the capture waits for every branch to settle, so no work outlives the capture.
  let failure: { error: unknown } | null = null;
  const live = () => {
    if (failure !== null) throw failure.error;
    checkDeadline();
  };
  // Reading a changed file holds a handle and the whole file across awaits; a cold capture of
  // thousands of files must not open them all at once. An operation that waited for a slot checks
  // again before it starts.
  const limited =
    (limit: ReturnType<typeof boundedConcurrency>) =>
    <T>(operation: () => Promise<T>) =>
      limit(async () => {
        live();
        return operation();
      });
  const reads = limited(boundedConcurrency(SNAPSHOT_READ_CONCURRENCY));
  const stats = limited(boundedConcurrency(SNAPSHOT_STAT_CONCURRENCY));

  /**
   * Visits a directory's entries and subdirectories concurrently, and returns its files in the
   * order a depth-first walk in sorted name order records them, so a capture's result does not
   * depend on which stat finished first.
   */
  /**
   * `directory` is absolute and `prefix` its repository path ("" at the root). Paths are joined as
   * strings: resolving and relativizing every entry cost about 30 ms per capture of this
   * repository, a fifth of the walk.
   */
  async function visit(directory: string, prefix: string): Promise<[string, string][]> {
    live();
    let entries;
    try {
      entries = await stats(() => readdir(directory, { withFileTypes: true }));
    } catch (error) {
      if (error instanceof RepositorySnapshotError) throw error;
      throw new RepositorySnapshotError("Could not read the repository snapshot.");
    }
    live();
    // A nested `.git` marks another checkout, such as a linked worktree, with its own snapshot.
    if (directory !== root && entries.some((entry) => entry.name === ".git")) return [];
    entries.sort((left, right) => nameOrder.compare(left.name, right.name));
    const visitEntry = async (entry: (typeof entries)[number]): Promise<[string, string][]> => {
      live();
      const absolutePath = `${directory}${sep}${entry.name}`;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (excludedPaths.has(path) || ignoredPaths.has(path) || ignoredPaths.has(`${path}/`))
        return [];
      if (entry.isDirectory())
        return excludedDirectories.has(entry.name) ? [] : visit(absolutePath, path);
      fileCount += 1;
      if (fileCount > resolvedPolicy.maxEntries) {
        throw new RepositorySnapshotError(
          "The repository snapshot file-count limit was exceeded.",
          undefined,
          "repository_snapshot_limit_exceeded",
        );
      }
      if (entry.isSymbolicLink()) {
        const before = await stats(() => lstat(absolutePath, { bigint: true }));
        const identity = entryIdentity(before);
        const cached = previousEntries.get(path);
        let hash: string;
        if (cached?.kind === "symlink" && cached.identity === identity) {
          hash = cached.hash;
        } else {
          const target = await stats(() => readlink(absolutePath));
          if (identity !== entryIdentity(await lstat(absolutePath, { bigint: true }))) {
            throw new RepositorySnapshotError("Could not snapshot the repository file safely.");
          }
          hash = sha256(`symlink\0${target}`);
        }
        nextEntries.set(path, { kind: "symlink", identity, hash, byteLength: 0 });
        return [[path, hash]];
      }
      if (!entry.isFile()) return [[path, sha256("unsupported-entry")]];
      try {
        const before = await stats(() => lstat(absolutePath, { bigint: true }));
        const identity = entryIdentity(before);
        const cached = previousEntries.get(path);
        let hash: string;
        let contentByteLength: number;
        if (cached?.kind === "file" && cached.identity === identity) {
          hash = cached.hash;
          contentByteLength = cached.byteLength;
        } else {
          // A read that started before the deadline finishes its identity check and keeps its
          // hash, so a capture that runs out of time still warms the cache with it.
          const bytes = await reads(() => input.readFile(root, path));
          const after = await lstat(absolutePath, { bigint: true });
          if (identity !== entryIdentity(after)) {
            throw new Error("changed while reading");
          }
          hash = sha256(bytes);
          contentByteLength = bytes.byteLength;
        }
        byteCount += contentByteLength;
        if (byteCount > resolvedPolicy.maxBytes) {
          throw new RepositorySnapshotError(
            "The repository snapshot byte limit was exceeded.",
            undefined,
            "repository_snapshot_limit_exceeded",
          );
        }
        nextEntries.set(path, {
          kind: "file",
          identity,
          hash,
          byteLength: contentByteLength,
        });
        live();
        return [[path, hash]];
      } catch (error) {
        if (error instanceof RepositorySnapshotError) throw error;
        throw new RepositorySnapshotError("Could not snapshot the repository file safely.", {
          cause: error,
        });
      }
    };
    const visited = await Promise.allSettled(
      entries.map((entry) =>
        visitEntry(entry).catch((error: unknown) => {
          failure ??= { error };
          throw failure.error;
        }),
      ),
    );
    if (failure !== null) throw failure.error;
    return visited.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  }

  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  try {
    for (const [path, hash] of await visit(root, "")) files[path] = hash;
  } catch (error) {
    if (
      error instanceof RepositorySnapshotError &&
      error.code === "repository_snapshot_deadline_exceeded"
    )
      partialStates.set(error, {
        cacheKey,
        entries: new Map([...previousEntries, ...nextEntries]),
      });
    throw error;
  }
  checkDeadline();
  if (head !== (await repositorySnapshotGitHead(input.repositoryRoot, resolvedPolicy.deadlineMs)))
    throw new RepositorySnapshotError("The Git coordinate changed during snapshot capture.");
  checkDeadline();
  const canonicalEntries = Object.keys(files)
    .sort()
    .map((path) => [path, files[path]]);
  return {
    snapshot: {
      revision: sha256(JSON.stringify(canonicalEntries)),
      files,
      ...(head === undefined
        ? {}
        : { commits: Object.fromEntries(Object.keys(files).map((path) => [path, head])) }),
    },
    state: { cacheKey, entries: nextEntries },
  };
}

/** Serializable stat-identity cache, so short-lived processes reuse unchanged file hashes. */
export interface RepositorySnapshotCacheState {
  schemaVersion: 1;
  cacheKey: string;
  entries: [string, CachedSnapshotEntry][];
}

/** The cache a capture that ran out of time had built, so its caller can keep the progress. */
export function partialRepositorySnapshotCache(
  error: unknown,
): RepositorySnapshotCacheState | undefined {
  const state = error instanceof RepositorySnapshotError ? partialStates.get(error) : undefined;
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
        : { cacheKey: input.previous.cacheKey, entries: new Map(input.previous.entries) },
    readFile: input.readFile ?? readRepositoryFile,
  });
  return {
    snapshot: result.snapshot,
    cache: {
      schemaVersion: 1,
      cacheKey: result.state.cacheKey,
      entries: [...result.state.entries],
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

export {
  changedRepositoryPaths,
  inspectManagedRepositoryChanges,
  type ManagedRepositoryChangeInspection,
} from "./repository-snapshot-changes.js";
