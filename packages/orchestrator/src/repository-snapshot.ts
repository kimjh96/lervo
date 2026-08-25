import { createHash } from "node:crypto";
import { lstat, readdir, readlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { readRepositoryFile } from "@lervo/context";
import type { ManagedFileChangeEvidence } from "./types.js";

export interface RepositorySnapshot {
  revision: string;
  files: Readonly<Record<string, string>>;
}

export type CaptureRepositorySnapshot = (
  repositoryRoot: string,
  policy?: RepositorySnapshotPolicy,
) => Promise<RepositorySnapshot>;

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
    "node_modules",
    "dist",
    "build",
    "build-device",
    "coverage",
    "Pods",
    "vendor",
  ]),
  excludedPaths: Object.freeze([".lervo/data", ".lervo/state"]),
  maxEntries: 20_000,
  maxBytes: 256 * 1024 * 1024,
});

export class RepositorySnapshotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositorySnapshotError";
  }
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
  const resolvedPolicy = resolveRepositorySnapshotPolicy(policy);
  const excludedDirectories = new Set(resolvedPolicy.excludedDirectoryNames);
  const excludedPaths = new Set(resolvedPolicy.excludedPaths);
  const root = resolve(repositoryRoot);
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
        const target = await readlink(absolutePath);
        files[path] = sha256(`symlink\0${target}`);
        continue;
      }
      if (!entry.isFile()) {
        files[path] = sha256("unsupported-entry");
        continue;
      }
      try {
        const before = await lstat(absolutePath, { bigint: true });
        const bytes = await readRepositoryFile(root, path);
        const after = await lstat(absolutePath, { bigint: true });
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        ) {
          throw new Error("changed while reading");
        }
        byteCount += bytes.byteLength;
        if (byteCount > resolvedPolicy.maxBytes) {
          throw new RepositorySnapshotError("The repository snapshot byte limit was exceeded.");
        }
        files[path] = sha256(bytes);
      } catch (error) {
        if (error instanceof RepositorySnapshotError) throw error;
        throw new RepositorySnapshotError("Could not snapshot the repository file safely.", {
          cause: error,
        });
      }
    }
  }

  await visit(root);
  const canonicalEntries = Object.keys(files)
    .sort()
    .map((path) => [path, files[path]]);
  return {
    revision: sha256(JSON.stringify(canonicalEntries)),
    files,
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
