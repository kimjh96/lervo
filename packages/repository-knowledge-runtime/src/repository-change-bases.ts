import { resolve } from "node:path";
import { isWithinRepositoryPath } from "./repository-change-classification.js";

/** A watched coordinate as the repository names it and as the filesystem resolves it. */
export interface RepositoryWatchBase {
  readonly logical: string;
  readonly real: string;
}

/**
 * Whether a recursive watch must be opened for `candidate`. Native recursive watches report the
 * resolved tree and do not follow links, so a base is already covered only when its real path lies
 * inside the real path of a watched base.
 */
export const needsRecursiveWatch = (
  candidate: RepositoryWatchBase,
  watched: readonly RepositoryWatchBase[],
  foldCase: boolean,
) => !watched.some((base) => isWithinRepositoryPath(base.real, candidate.real, foldCase));

/**
 * Translates an event reported under `handle`'s real path into the logical frame of the most
 * specific known base, so `.lervo/state` linked elsewhere still classifies as `.lervo/state`.
 */
export function locateRepositoryEvent(
  handle: RepositoryWatchBase,
  filename: string | undefined,
  bases: readonly RepositoryWatchBase[],
  foldCase: boolean,
): { base: string; filename: string | undefined } {
  if (filename === undefined) return { base: handle.logical, filename };
  const path = resolve(handle.real, filename);
  let owner = handle;
  for (const base of bases)
    if (base.real.length > owner.real.length && isWithinRepositoryPath(base.real, path, foldCase))
      owner = base;
  if (!isWithinRepositoryPath(owner.real, path, foldCase))
    return { base: handle.logical, filename };
  return { base: owner.logical, filename: path.slice(owner.real.length).replace(/^[\\/]+/, "") };
}
