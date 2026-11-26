import { lstat } from "node:fs/promises";
import { sep } from "node:path";

import { repositorySnapshotGitIgnoredPaths } from "./repository-snapshot-git.js";
import { RepositorySnapshotError } from "./repository-snapshot-policy.js";

/**
 * Git's current ignored paths. A walk that fails first leaves the listing unawaited; its failure
 * is then the walk's to report.
 */
export function freshIgnoredPaths(
  repositoryRoot: string,
  deadlineMs: number | undefined,
): Promise<ReadonlySet<string>> {
  const listing = repositorySnapshotGitIgnoredPaths(repositoryRoot, deadlineMs).then((ignored) => {
    // A listing cut off by the deadline reports the deadline, as a capture waiting for it did.
    if (deadlineMs !== undefined && performance.now() >= deadlineMs)
      throw new RepositorySnapshotError(
        "The repository snapshot deadline was exceeded.",
        undefined,
        "repository_snapshot_deadline_exceeded",
      );
    if (ignored.status === "unavailable")
      throw new RepositorySnapshotError(
        "Git ignored paths are unavailable.",
        undefined,
        "git_ignored_paths_unavailable",
      );
    return ignored.paths;
  });
  listing.catch(() => undefined);
  return listing;
}

export interface IgnoredPathJudge {
  /** Whether Git ignores `path`, a directory when `directory` is true. */
  ignores(path: string, directory: boolean): Promise<boolean>;
  /** Whether the fresh list ignores `path`; a file is read only once this says it may be. */
  ignoredNow(path: string): Promise<boolean>;
  /** Judges every later path by `paths`. */
  settle(paths: ReadonlySet<string>): void;
  /**
   * Whether the fresh list equals the previous one. Every path was then judged as the fresh list
   * judges it: a path the previous capture recorded had no ignored directory above it.
   */
  unchanged(): boolean;
}

/**
 * Judges the walk's paths while Git lists ignored paths again. With the previous capture's list, a
 * path that capture saw (a file it recorded, a directory holding one, or a path it ignored) is
 * judged by that list, and any other path waits for the fresh one, so a new directory Git ignores
 * is never walked. Reading a file always waits for the fresh list, so no file is read before Git
 * has judged it. Without a previous list, every path waits. Once the fresh list arrives, every
 * later path is judged by it, together with the directories that hold it.
 */
export function ignoredPathJudge(input: {
  previous: ReadonlySet<string> | undefined;
  previousFiles: Iterable<string>;
  fresh: Promise<ReadonlySet<string>>;
}): IgnoredPathJudge {
  const { previous, fresh } = input;
  let listed: ReadonlySet<string> | undefined;
  let same = false;
  void fresh.then(
    (paths) => {
      // An unchanged list keeps judging seen paths exactly as before, without their directories.
      same = previous !== undefined && sameSet(previous, paths);
      if (!same) listed = paths;
    },
    () => undefined,
  );
  const previousFiles = new Set<string>();
  const previousDirectories = new Set<string>();
  if (previous !== undefined)
    for (const path of input.previousFiles) {
      previousFiles.add(path);
      for (let end = path.lastIndexOf("/"); end > 0; end = path.lastIndexOf("/", end - 1)) {
        const directory = path.slice(0, end);
        if (previousDirectories.has(directory)) break;
        previousDirectories.add(directory);
      }
    }
  return {
    async ignores(path, directory) {
      let paths = listed;
      if (paths === undefined) {
        const seen =
          previous !== undefined &&
          (previous.has(path) ||
            previous.has(`${path}/`) ||
            (directory ? previousDirectories : previousFiles).has(path));
        paths = seen ? previous : await fresh;
      }
      return ignoredWithin(paths, path);
    },
    async ignoredNow(path) {
      return ignoredWithin(listed ?? (await fresh), path);
    },
    settle(paths) {
      listed = paths;
      same = false;
    },
    unchanged: () => same,
  };
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const path of left) if (!right.has(path)) return false;
  return true;
}

/** Whether Git ignores `path`, as a file or a directory, or a directory that holds it. */
function ignoredWithin(ignored: ReadonlySet<string>, path: string): boolean {
  return ignored.has(`${path}/`) || ignoredBy(ignored, path);
}

/** Whether Git ignores `path` itself or a directory that holds it. */
export function ignoredBy(ignored: ReadonlySet<string>, path: string): boolean {
  if (ignored.has(path)) return true;
  for (let end = path.indexOf("/"); end !== -1; end = path.indexOf("/", end + 1))
    if (ignored.has(path.slice(0, end + 1))) return true;
  return false;
}

/** Whether a path that Git ignored before, and that still exists, is no longer ignored. */
export async function reincluded(
  root: string,
  previous: ReadonlySet<string>,
  fresh: ReadonlySet<string>,
): Promise<boolean> {
  for (const path of previous) {
    const bare = path.replace(/\/$/u, "");
    if (fresh.has(path) || ignoredBy(fresh, bare)) continue;
    const exists = await lstat(`${root}${sep}${bare}`).then(
      () => true,
      () => false,
    );
    if (exists) return true;
  }
  return false;
}
