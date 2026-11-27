// What a conversation's checkout changed since its generation's base (Lervo ADE coordination,
// "Reconciliation"): committed, staged, and unstaged changes against the base, and untracked
// paths Git does not ignore. The core decides which of them a claim may name.
import { execFile } from "node:child_process";

const GIT_TIMEOUT_MS = 2_000;
/** Enough for well past 10,000 paths of ordinary length; a larger listing fails as unavailable. */
const MAXIMUM_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const COMMIT = /^[a-f0-9]{40,64}$/u;

/** The process environment without variables that would point Git at another repository. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_COMMON_DIR: _common, ...rest } = process.env;
  return rest;
}

function gitPaths(worktree: string, args: readonly string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", worktree, ...args],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
        env: gitEnvironment(),
        encoding: "utf8",
      },
      (error, stdout) =>
        resolve(error === null ? stdout.split("\0").filter((path) => path !== "") : null),
    );
  });
}

/**
 * The repository-relative paths `worktree` changed since `baseCommit`, sorted, or null when Git
 * could not list them. Renames count as their source and their target, since both paths changed.
 */
export async function listCheckoutChangedPaths(
  worktree: string,
  baseCommit: string,
): Promise<string[] | null> {
  if (!COMMIT.test(baseCommit)) return null;
  const [tracked, untracked] = await Promise.all([
    gitPaths(worktree, ["diff", "--name-only", "--no-renames", "-z", baseCommit, "--"]),
    gitPaths(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (tracked === null || untracked === null) return null;
  return [...new Set([...tracked, ...untracked])].sort();
}
