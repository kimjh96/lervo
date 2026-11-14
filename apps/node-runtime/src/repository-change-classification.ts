import { basename, dirname, resolve } from "node:path";

const replicaRequestName = "repository-replica-request.json";
const gitCoordinateNames = new Set(["HEAD", "index", "packed-refs", "config"]);
const refreshNames = new Set([".gitignore", "exclude"]);

/** Absolute directories whose direct children are repository change coordinates. */
export interface RepositoryChangeScope {
  readonly directories: ReadonlySet<string>;
  readonly state: string;
  readonly gitRoots: ReadonlySet<string>;
}

export interface RepositoryChangeDecision {
  readonly notify: boolean;
  readonly refresh: boolean;
}

/**
 * Decides whether one native event, reported relative to the watched `base`, is a repository
 * change. Only direct children of scope directories count, so events inside ignored caches or
 * Git object storage are dropped whether the native watch was per directory or recursive.
 */
export function classifyRepositoryChange(
  event: string,
  base: string,
  filename: string | undefined,
  scope: RepositoryChangeScope,
): RepositoryChangeDecision {
  if (filename === undefined || filename === "") return { notify: true, refresh: true };
  const path = resolve(base, filename);
  const parent = dirname(path);
  const name = basename(path);
  const notify =
    parent === scope.state
      ? name === replicaRequestName
      : scope.gitRoots.has(parent)
        ? gitCoordinateNames.has(name)
        : scope.directories.has(parent);
  return { notify, refresh: notify && (event === "rename" || refreshNames.has(name)) };
}
