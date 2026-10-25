import { transientToolCacheDirectoryNames } from "@lervo/context";

export interface RepositorySnapshotPolicy {
  excludedDirectoryNames: readonly string[];
  excludedPaths: readonly string[];
  maxEntries: number;
  maxBytes: number;
  /** Absolute monotonic deadline, scoped to this capture rather than its cache identity. */
  deadlineMs?: number;
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
  constructor(
    message: string,
    options?: ErrorOptions,
    readonly code:
      | "repository_snapshot_limit_exceeded"
      | "repository_snapshot_deadline_exceeded"
      | "git_ignored_paths_unavailable"
      | "repository_snapshot_failed" = "repository_snapshot_failed",
  ) {
    super(message, options);
    this.name = "RepositorySnapshotError";
  }
}

export function resolveRepositorySnapshotPolicy(
  policy: RepositorySnapshotPolicy = defaultRepositorySnapshotPolicy,
): RepositorySnapshotPolicy {
  const resolved = {
    excludedDirectoryNames: [...policy.excludedDirectoryNames],
    excludedPaths: [...policy.excludedPaths],
    maxEntries: policy.maxEntries,
    maxBytes: policy.maxBytes,
    ...(policy.deadlineMs === undefined ? {} : { deadlineMs: policy.deadlineMs }),
  };
  if (
    (resolved.deadlineMs !== undefined && !Number.isFinite(resolved.deadlineMs)) ||
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
