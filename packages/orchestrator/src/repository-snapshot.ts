import { repositorySnapshotGitHead } from "./repository-snapshot-git.js";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { readRepositoryFile, transientToolCacheDirectoryNames } from "@lervo/context";
import type { ManagedFileChangeEvidence } from "./types.js";

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

export interface RepositorySnapshotPolicy {
  excludedDirectoryNames: readonly string[];
  excludedPaths: readonly string[];
  maxEntries: number;
  maxBytes: number;
}

export const defaultRepositorySnapshotPolicy: RepositorySnapshotPolicy = Object.freeze({
  excludedDirectoryNames: Object.freeze([
    ".git",
    ".next",
    ".turbo",
    ".expo",
    ".gradle",
    ".cxx",
    ".vercel",
    ".cache",
    ...transientToolCacheDirectoryNames.filter((name) => name !== ".cache"),
    ".venv",
    "node_modules",
    "venv",
    "dist",
    "build",
    "build-device",
    "coverage",
    "Pods",
    "vendor",
  ]),
  excludedPaths: Object.freeze([".lervo/data", ".lervo/state"]),
  maxEntries: 20_000,
  maxBytes: 1024 * 1024 * 1024,
});

export class RepositorySnapshotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositorySnapshotError";
  }
}

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

export function resolveRepositorySnapshotPolicy(
  policy: RepositorySnapshotPolicy = defaultRepositorySnapshotPolicy,
): RepositorySnapshotPolicy {
  const resolved = {
    excludedDirectoryNames: [...policy.excludedDirectoryNames],
    excludedPaths: [...policy.excludedPaths],
    maxEntries: policy.maxEntries,
    maxBytes: policy.maxBytes,
  };
  if (
    !Number.isSafeInteger(resolved.maxEntries) ||
    resolved.maxEntries < 1 ||
    !Number.isSafeInteger(resolved.maxBytes) ||
    resolved.maxBytes < 1 ||
    resolved.excludedDirectoryNames.some(
      (name) =>
        name.length === 0 ||
        name === "." ||
        name === ".." ||
        name.includes("/") ||
        name.includes("\\"),
    ) ||
    resolved.excludedPaths.some(
      (path) =>
        path.length === 0 ||
        path.startsWith("/") ||
        path.endsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part) => part.length === 0 || part === "." || part === ".."),
    )
  ) {
    throw new RepositorySnapshotError("The repository snapshot policy is invalid.");
  }
  return Object.freeze({
    ...resolved,
    excludedDirectoryNames: Object.freeze(resolved.excludedDirectoryNames),
    excludedPaths: Object.freeze(resolved.excludedPaths),
  });
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
  const head = await repositorySnapshotGitHead(input.repositoryRoot);
  const resolvedPolicy = resolveRepositorySnapshotPolicy(input.policy);
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
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new RepositorySnapshotError("Could not read the repository snapshot.");
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const path = portablePath(root, absolutePath);
      if (excludedPaths.has(path)) continue;
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }
      fileCount += 1;
      if (fileCount > resolvedPolicy.maxEntries) {
        throw new RepositorySnapshotError("The repository snapshot file-count limit was exceeded.");
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
          const after = await lstat(absolutePath, { bigint: true });
          if (identity !== entryIdentity(after)) {
            throw new Error("changed while reading");
          }
          hash = sha256(bytes);
          contentByteLength = bytes.byteLength;
        }
        byteCount += contentByteLength;
        if (byteCount > resolvedPolicy.maxBytes) {
          throw new RepositorySnapshotError("The repository snapshot byte limit was exceeded.");
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
  if (head !== (await repositorySnapshotGitHead(input.repositoryRoot)))
    throw new RepositorySnapshotError("The Git coordinate changed during snapshot capture.");
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

export function changedRepositoryPaths(
  before: RepositorySnapshot,
  after: RepositorySnapshot,
): string[] {
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  return [...paths].filter((path) => before.files[path] !== after.files[path]).sort();
}

export interface ManagedRepositoryChangeInspection {
  changedPaths: string[];
  verifiedManagedPaths: string[];
  invalidManagedPaths: string[];
  unmanagedPaths: string[];
}

export function inspectManagedRepositoryChanges(input: {
  before: RepositorySnapshot;
  after: RepositorySnapshot;
  managedChanges: readonly ManagedFileChangeEvidence[];
}): ManagedRepositoryChangeInspection {
  const changedPaths = changedRepositoryPaths(input.before, input.after);
  const verifiedManagedPaths = new Set<string>();
  const invalidManagedPaths = new Set<string>();
  for (const change of input.managedChanges) {
    const beforeHash = input.before.files[change.path] ?? null;
    const afterHash = input.after.files[change.path] ?? null;
    if (
      verifiedManagedPaths.has(change.path) ||
      beforeHash !== change.beforeHash ||
      afterHash !== change.afterHash ||
      !changedPaths.includes(change.path)
    ) {
      invalidManagedPaths.add(change.path);
    } else {
      verifiedManagedPaths.add(change.path);
    }
  }
  return {
    changedPaths,
    verifiedManagedPaths: [...verifiedManagedPaths].sort(),
    invalidManagedPaths: [...invalidManagedPaths].sort(),
    unmanagedPaths: changedPaths.filter(
      (path) => !verifiedManagedPaths.has(path) || invalidManagedPaths.has(path),
    ),
  };
}
