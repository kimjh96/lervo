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
import { relative, resolve, sep } from "node:path";

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

interface SnapshotCaptureState {
  cacheKey: string;
  entries: ReadonlyMap<string, CachedSnapshotEntry>;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function portablePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

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
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let fileCount = 0;
  let byteCount = 0;

  async function visit(directory: string): Promise<void> {
    checkDeadline();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new RepositorySnapshotError("Could not read the repository snapshot.");
    }
    checkDeadline();
    // A nested `.git` marks another checkout, such as a linked worktree, with its own snapshot.
    if (directory !== root && entries.some((entry) => entry.name === ".git")) return;
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      checkDeadline();
      const absolutePath = resolve(directory, entry.name);
      const path = portablePath(root, absolutePath);
      if (excludedPaths.has(path) || ignoredPaths.has(path) || ignoredPaths.has(`${path}/`))
        continue;
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }
      fileCount += 1;
      if (fileCount > resolvedPolicy.maxEntries) {
        throw new RepositorySnapshotError(
          "The repository snapshot file-count limit was exceeded.",
          undefined,
          "repository_snapshot_limit_exceeded",
        );
      }
      if (entry.isSymbolicLink()) {
        const before = await lstat(absolutePath, { bigint: true });
        const identity = entryIdentity(before);
        const cached = previousEntries.get(path);
        let hash: string;
        if (cached?.kind === "symlink" && cached.identity === identity) {
          hash = cached.hash;
        } else {
          const target = await readlink(absolutePath);
          if (identity !== entryIdentity(await lstat(absolutePath, { bigint: true }))) {
            throw new RepositorySnapshotError("Could not snapshot the repository file safely.");
          }
          hash = sha256(`symlink\0${target}`);
        }
        files[path] = hash;
        nextEntries.set(path, { kind: "symlink", identity, hash, byteLength: 0 });
        continue;
      }
      if (!entry.isFile()) {
        files[path] = sha256("unsupported-entry");
        continue;
      }
      try {
        const before = await lstat(absolutePath, { bigint: true });
        const identity = entryIdentity(before);
        const cached = previousEntries.get(path);
        let hash: string;
        let contentByteLength: number;
        if (cached?.kind === "file" && cached.identity === identity) {
          hash = cached.hash;
          contentByteLength = cached.byteLength;
        } else {
          const bytes = await input.readFile(root, path);
          checkDeadline();
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
        files[path] = hash;
        nextEntries.set(path, {
          kind: "file",
          identity,
          hash,
          byteLength: contentByteLength,
        });
      } catch (error) {
        if (error instanceof RepositorySnapshotError) throw error;
        throw new RepositorySnapshotError("Could not snapshot the repository file safely.", {
          cause: error,
        });
      }
    }
  }

  await visit(root);
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

export async function captureRepositorySnapshotIncrementally(input: {
  repositoryRoot: string;
  previous?: RepositorySnapshotCacheState;
  policy?: RepositorySnapshotPolicy;
}): Promise<{ snapshot: RepositorySnapshot; cache: RepositorySnapshotCacheState }> {
  const result = await captureRepositorySnapshotWithCache({
    repositoryRoot: input.repositoryRoot,
    policy: input.policy ?? defaultRepositorySnapshotPolicy,
    previous:
      input.previous === undefined
        ? undefined
        : { cacheKey: input.previous.cacheKey, entries: new Map(input.previous.entries) },
    readFile: readRepositoryFile,
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
