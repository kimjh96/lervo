import {
  gitIgnoreObservation,
  ignoredPathsBelowPrefix,
  nothingIgnored,
} from "./git-ignored-status.js";

/** Untracked paths Git ignores; tracked files stay repository content even when a pattern matches. */
export interface GitIgnoredPaths {
  ignores(path: string, isDirectory: boolean): boolean;
  /**
   * ADR-0582: equal for two observations that ignore exactly the same `relevant` paths. Absent,
   * an observation is never proven equal to another, so a scan that used it is not reused.
   */
  identity?(relevant: (path: string) => boolean): string;
}

export type ObserveGitIgnoredPaths = (repositoryRoot: string) => Promise<GitIgnoredPaths>;

/**
 * Reads the untracked paths that match an ignore pattern, as `git status --ignored=matching`
 * reports them: an ignored directory once, without its contents. Outside a Git work tree, or when
 * Git cannot answer, nothing is ignored and the scan reads the tree as before.
 */
export const observeGitIgnoredPaths: ObserveGitIgnoredPaths = async (repositoryRoot) => {
  let prefix: string;
  try {
    // Porcelain paths are relative to the work tree top, which may sit above the scanned root.
    prefix = (await gitIgnoreObservation(repositoryRoot, ["rev-parse", "--show-prefix"])).trim();
  } catch {
    return nothingIgnored;
  }
  return ignoredPathsBelowPrefix(repositoryRoot, prefix);
};
