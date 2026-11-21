import { basename, dirname, resolve, sep } from "node:path";

const replicaRequestName = "repository-replica-request.json";
/** ADR-0606: a foreground writer's request that the resident looks at its knowledge inputs. */
export const KNOWLEDGE_RESIDENT_REQUEST_NAME = "knowledge-resident-request.json";
const gitCoordinateNames = new Set(["HEAD", "index", "packed-refs", "config"]);
const refreshNames = new Set([".gitignore", "exclude"]);

/**
 * Compares paths the way the volume does. Git can record `Source/file.ts` under
 * `core.ignoreCase` while the disk and native events say `source`, so case-insensitive hosts fold
 * case and Unicode composition. Folding on a case-sensitive volume only over-notifies, which is
 * harmless because a notification is a hint followed by authoritative verification.
 */
export const repositoryPathKey = (path: string, foldCase: boolean) =>
  foldCase ? path.normalize("NFC").toLowerCase() : path;

/** Whether `path` is `base` or lies inside it, under the same case policy. */
export const isWithinRepositoryPath = (base: string, path: string, foldCase: boolean) => {
  const baseKey = repositoryPathKey(base, foldCase);
  const pathKey = repositoryPathKey(path, foldCase);
  return pathKey === baseKey || pathKey.startsWith(`${baseKey}${sep}`);
};

/** Directories whose direct children are repository change coordinates, keyed for comparison. */
export interface RepositoryChangeScope {
  readonly foldCase: boolean;
  readonly directories: ReadonlySet<string>;
  readonly state: string;
  readonly gitRoots: ReadonlySet<string>;
}

export function createRepositoryChangeScope(input: {
  directories: Iterable<string>;
  state: string;
  gitRoots: Iterable<string>;
  foldCase: boolean;
}): RepositoryChangeScope {
  const key = (path: string) => repositoryPathKey(path, input.foldCase);
  return {
    foldCase: input.foldCase,
    directories: new Set([...input.directories].map(key)),
    state: key(input.state),
    gitRoots: new Set([...input.gitRoots].map(key)),
  };
}

export interface RepositoryChangeDecision {
  readonly notify: boolean;
  readonly refresh: boolean;
}

/**
 * Decides whether one native event, reported relative to the watched `base`, is a repository
 * change. Only direct children of scope directories count, so events inside ignored caches or
 * Git object storage are dropped whether the native watch was per directory or recursive. An
 * event without a filename, or naming the watched base itself, is treated conservatively.
 */
export function classifyRepositoryChange(
  event: string,
  base: string,
  filename: string | undefined,
  scope: RepositoryChangeScope,
): RepositoryChangeDecision {
  if (filename === undefined) return { notify: true, refresh: true };
  const key = (path: string) => repositoryPathKey(path, scope.foldCase);
  const path = resolve(base, filename);
  if (key(path) === key(base)) return { notify: true, refresh: true };
  const parent = key(dirname(path));
  const name = basename(path);
  const notify =
    parent === scope.state
      ? name === replicaRequestName || name === KNOWLEDGE_RESIDENT_REQUEST_NAME
      : scope.gitRoots.has(parent)
        ? gitCoordinateNames.has(name)
        : scope.directories.has(parent);
  return { notify, refresh: notify && (event === "rename" || refreshNames.has(name)) };
}
