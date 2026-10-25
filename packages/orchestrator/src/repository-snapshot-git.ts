import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

function gitTimeout(maximumMs: number, deadlineMs?: number): number {
  return Math.max(1, Math.min(maximumMs, Math.ceil((deadlineMs ?? Infinity) - performance.now())));
}

export type RepositorySnapshotIgnoredPaths =
  { status: "available"; paths: ReadonlySet<string> } | { status: "unavailable" };

/** A snapshot pins the observed commit. Blob digest comparison still rejects dirty former bytes. */
export async function repositorySnapshotGitHead(
  root: string,
  deadlineMs?: number,
): Promise<string | undefined> {
  try {
    const { stdout } = await execute("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      timeout: gitTimeout(5_000, deadlineMs),
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
 * files stay in the snapshot. Outside a Git repository, a successful worktree probe establishes that nothing is ignored.
 */
export async function repositorySnapshotGitIgnoredPaths(
  root: string,
  deadlineMs?: number,
): Promise<RepositorySnapshotIgnoredPaths> {
  try {
    // A plain directory is supported, but an unreadable Git repository must not look empty.
    const probe = await execute("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      timeout: gitTimeout(5_000, deadlineMs),
      maxBuffer: 4096,
      env: { ...process.env, LC_ALL: "C" },
    }).catch((error: unknown) => {
      const failure = error as { code?: unknown; stderr?: unknown };
      if (
        failure.code === 128 &&
        typeof failure.stderr === "string" &&
        /^fatal: not a git repository \(or any of the parent directories\): \.git\r?\n?$/u.test(
          failure.stderr,
        )
      )
        return null;
      throw error;
    });
    if (probe === null) return { status: "available", paths: new Set() };
    if (probe.stdout.trim() !== "true") return { status: "unavailable" };
    const { stdout } = await execute(
      "git",
      ["-C", root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      { timeout: gitTimeout(10_000, deadlineMs), maxBuffer: 64 * 1024 * 1024 },
    );
    return {
      status: "available",
      paths: new Set(stdout.split("\0").filter((path) => path.length > 0)),
    };
  } catch {
    return { status: "unavailable" };
  }
}
