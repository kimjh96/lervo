import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

/** Untracked paths Git ignores; tracked files stay repository content even when a pattern matches. */
export interface GitIgnoredPaths {
  ignores(path: string, isDirectory: boolean): boolean;
}

export type ObserveGitIgnoredPaths = (repositoryRoot: string) => Promise<GitIgnoredPaths>;

const nothingIgnored: GitIgnoredPaths = { ignores: () => false };

/**
 * Reads the untracked paths that match an ignore pattern, as `git status --ignored=matching`
 * reports them: an ignored directory once, without its contents. Outside a Git work tree, or when
 * Git cannot answer, nothing is ignored and the scan reads the tree as before.
 */
export const observeGitIgnoredPaths: ObserveGitIgnoredPaths = async (repositoryRoot) => {
  const git = async (args: string[]) =>
    (
      await executeFile("git", args, {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
      })
    ).stdout;
  let prefix: string;
  let output: string;
  try {
    // Porcelain paths are relative to the work tree top, which may sit above the scanned root.
    prefix = (await git(["rev-parse", "--show-prefix"])).trim();
    output = await git([
      "status",
      "--porcelain=v2",
      "-z",
      "--ignored=matching",
      "--untracked-files=all",
      "--no-renames",
      "--",
      ".",
    ]);
  } catch {
    return nothingIgnored;
  }
  const directories = new Set<string>();
  const files = new Set<string>();
  for (const record of output.split("\0")) {
    if (!record.startsWith(`! ${prefix}`)) continue;
    const path = record.slice(2 + prefix.length);
    if (path.endsWith("/")) directories.add(path.slice(0, -1));
    else files.add(path);
  }
  return {
    ignores: (path, isDirectory) => (isDirectory ? directories : files).has(path),
  };
};
