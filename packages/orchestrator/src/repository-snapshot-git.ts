import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
/** A snapshot pins the observed commit. Blob digest comparison still rejects dirty former bytes. */
export async function repositorySnapshotGitHead(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execute("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      timeout: 5_000,
      maxBuffer: 4096,
    });
    const head = stdout.trim();
    return /^[a-f0-9]{40,64}$/u.test(head) ? head : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Untracked paths Git ignores through `.gitignore`, `info/exclude`, and `core.excludesFile`.
 * Fully ignored directories end with `/`, so capture skips them without descending. Tracked
 * files stay in the snapshot. Outside a Git repository, nothing is ignored.
 */
export async function repositorySnapshotGitIgnoredPaths(
  root: string,
): Promise<ReadonlySet<string>> {
  try {
    const { stdout } = await execute(
      "git",
      ["-C", root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      { timeout: 10_000, maxBuffer: 64 * 1024 * 1024 },
    );
    return new Set(stdout.split("\0").filter((path) => path.length > 0));
  } catch {
    return new Set();
  }
}
