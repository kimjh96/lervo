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
import { repositorySnapshotGitHead } from "./repository-snapshot-git.js";
import {
  freshIgnoredPaths,
  ignoredBy,
  ignoredPathJudge,
  reincluded,
} from "./repository-snapshot-ignored.js";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { readRepositoryFile } from "@lervo/context";

import { boundedConcurrency, type BoundedConcurrency } from "./bounded-concurrency.js";

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

/** @internal The state a capture that ran out of time had built, if `error` is that rejection. */
export function partialSnapshotCaptureState(error: unknown): SnapshotCaptureState | undefined {
  return error instanceof RepositorySnapshotError ? partialStates.get(error) : undefined;
}

export interface SnapshotCaptureState {
  cacheKey: string;
  entries: ReadonlyMap<string, CachedSnapshotEntry>;
  /** The paths Git ignored at that capture, so the next one can walk while Git lists them again. */
  ignoredPaths?: ReadonlySet<string>;
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

/**
 * `localeCompare`'s order, from one collator instead of one per comparison (ECMA-402). A Node built
 * without `Intl` keeps `localeCompare` itself.
 */
const nameOrder: { compare(left: string, right: string): number } =
  typeof Intl === "object"
    ? new Intl.Collator()
    : { compare: (left, right) => left.localeCompare(right) };

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

/**
 * @internal A capture that reuses `previous`; the cache module keeps its state across captures.
 */
export async function captureRepositorySnapshotWithCache(input: {
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
  const excludedDirectories = new Set(resolvedPolicy.excludedDirectoryNames);
  const excludedPaths = new Set(resolvedPolicy.excludedPaths);
  const root = resolve(input.repositoryRoot);
  const cacheKey = snapshotCacheKey(root, resolvedPolicy);
  const previous = input.previous?.cacheKey === cacheKey ? input.previous : undefined;
  let previousEntries: ReadonlyMap<string, CachedSnapshotEntry> =
    previous?.entries ?? new Map<string, CachedSnapshotEntry>();
  const headRead = repositorySnapshotGitHead(input.repositoryRoot, resolvedPolicy.deadlineMs);
  const freshIgnored = freshIgnoredPaths(input.repositoryRoot, resolvedPolicy.deadlineMs);
  headRead.catch(() => undefined);
  // With the previous capture's ignored paths, the walk starts while Git lists them again. The
  // fresh list then removes what it ignores, and a path it no longer ignores re-walks.
  const previousIgnored = previous?.ignoredPaths;
  const judge = ignoredPathJudge({
    previous: previousIgnored,
    previousFiles: previousEntries.keys(),
    fresh: freshIgnored,
  });
  // Without a previous list, Git's unavailability still rejects before traversal.
  if (previousIgnored === undefined) await freshIgnored;
  const head = await headRead;
  let nextEntries = new Map<string, CachedSnapshotEntry>();
  try {
    checkDeadline();
    const rootStats = await lstat(root).catch(() => null);
    if (rootStats === null || !rootStats.isDirectory() || rootStats.isSymbolicLink())
      throw new RepositorySnapshotError(
        "The repository snapshot root is not a safe real directory.",
      );
  } catch (error) {
    await freshIgnored.catch(() => undefined);
    throw error;
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
    (limit: BoundedConcurrency) =>
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
      if (excludedPaths.has(path) || (await judge.ignores(path, entry.isDirectory()))) return [];
      live();
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
          if (await judge.ignoredNow(path)) {
            fileCount -= 1;
            return [];
          }
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
          // Never read a file Git now ignores, even one the previous list did not.
          if (await judge.ignoredNow(path)) {
            fileCount -= 1;
            return [];
          }
          live();
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
  let fresh: ReadonlySet<string> | undefined;
  // Walks again judging every path by the fresh list, reusing the hashes computed so far.
  const rewalk = async (paths: ReadonlySet<string>) => {
    previousEntries = new Map([...previousEntries, ...nextEntries]);
    nextEntries = new Map();
    fileCount = 0;
    byteCount = 0;
    failure = null;
    judge.settle(paths);
    return visit(root, "");
  };
  try {
    let walked: [string, string][];
    try {
      walked = await visit(root, "");
    } catch (error) {
      // Paths the fresh list ignores may have counted toward a limit; only it can tell.
      if (
        previousIgnored === undefined ||
        !(error instanceof RepositorySnapshotError) ||
        error.code !== "repository_snapshot_limit_exceeded"
      )
        throw error;
      fresh = await freshIgnored;
      walked = await rewalk(fresh);
    }
    const listed = (fresh ??= await freshIgnored);
    checkDeadline();
    if (previousIgnored !== undefined && !judge.unchanged()) {
      if (await reincluded(root, previousIgnored, listed)) {
        // A path Git ignored before and no longer does was never walked.
        walked = await rewalk(listed);
      } else {
        walked = walked.filter(([path]) => !ignoredBy(listed, path));
        for (const path of nextEntries.keys())
          if (ignoredBy(listed, path)) nextEntries.delete(path);
      }
    }
    for (const [path, hash] of walked) files[path] = hash;
  } catch (error) {
    if (
      error instanceof RepositorySnapshotError &&
      error.code === "repository_snapshot_deadline_exceeded"
    )
      partialStates.set(error, {
        cacheKey,
        entries: new Map([...previousEntries, ...nextEntries]),
      });
    // Git's listing, bounded by the same deadline, never outlives the capture.
    await freshIgnored.catch(() => undefined);
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
    state: { cacheKey, entries: nextEntries, ignoredPaths: fresh! },
  };
}

export {
  changedRepositoryPaths,
  inspectManagedRepositoryChanges,
  type ManagedRepositoryChangeInspection,
} from "./repository-snapshot-changes.js";
