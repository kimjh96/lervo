import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GitIgnoredPaths } from "./git-ignored-paths.js";
import { sha256 } from "./integrity.js";

const executeFile = promisify(execFile);

export const nothingIgnored: GitIgnoredPaths = {
  ignores: () => false,
  identity: () => "nothing",
};

/** One read-only Git observation with the environment every ignore probe shares. */
export async function gitIgnoreObservation(repositoryRoot: string, args: string[]) {
  return (
    await executeFile("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    })
  ).stdout;
}

/**
 * Reads the untracked paths that match an ignore pattern, as `git status --ignored=matching`
 * reports them: an ignored directory once, without its contents. Porcelain paths are relative to
 * the work tree top, so `prefix` is the scanned root's `git rev-parse --show-prefix` output.
 */
export async function ignoredPathsBelowPrefix(
  repositoryRoot: string,
  prefix: string,
): Promise<GitIgnoredPaths> {
  let output: string;
  try {
    output = await gitIgnoreObservation(repositoryRoot, [
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
    identity: (relevant) =>
      sha256(
        [...[...directories].map((path) => `${path}/`), ...files]
          .filter((path) => relevant(path.replace(/\/$/u, "")))
          .sort()
          .join("\0"),
      ),
  };
}
