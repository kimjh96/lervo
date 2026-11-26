import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
const execute = promisify(execFile);

function gitTimeout(maximumMs: number, deadlineMs?: number): number {
  return Math.max(1, Math.min(maximumMs, Math.ceil((deadlineMs ?? Infinity) - performance.now())));
}

export type RepositorySnapshotIgnoredPaths =
  { status: "available"; paths: ReadonlySet<string> } | { status: "unavailable" };

const COMMIT = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/u;
const REF = /^refs\/[A-Za-z0-9._/-]+$/u;
/** Variables that make Git resolve another repository or ref than its files at `root`. */
const REPOSITORY_OVERRIDES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE"];

async function readSmall(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return content.length <= 64 * 1024 ? content : undefined;
  } catch {
    return undefined;
  }
}

/**
 * HEAD read from the repository's files, as `git rev-parse` would resolve it, or undefined when
 * anything is unusual: a repository override such as `GIT_DIR`, a reftable store, a symbolic chain, or a ref this reader
 * cannot find, so the caller asks Git. A snapshot reads HEAD twice; each `git` process cost about
 * 10 ms on every prompt and Stop.
 */
export async function gitHeadFromFiles(root: string): Promise<string | undefined> {
  if (REPOSITORY_OVERRIDES.some((name) => process.env[name] !== undefined)) return undefined;
  const dotGit = resolve(root, ".git");
  let gitDirectory = dotGit;
  const pointer = await readSmall(dotGit);
  if (pointer !== undefined) {
    const match = /^gitdir: (.+)\n?$/u.exec(pointer);
    if (match === null) return undefined;
    gitDirectory = resolve(root, match[1]!);
  }
  const common = await readSmall(resolve(gitDirectory, "commondir"));
  const commonDirectory =
    common === undefined ? gitDirectory : resolve(gitDirectory, common.trim());
  if ((await readSmall(resolve(commonDirectory, "reftable", "tables.list"))) !== undefined)
    return undefined;
  const head = (await readSmall(resolve(gitDirectory, "HEAD")))?.trim();
  if (head === undefined) return undefined;
  if (COMMIT.test(head)) return head;
  const ref = /^ref: (.+)$/u.exec(head)?.[1];
  if (ref === undefined || !REF.test(ref) || ref.includes("..") || ref.endsWith(".invalid"))
    return undefined;
  for (const directory of [gitDirectory, commonDirectory]) {
    const loose = (await readSmall(resolve(directory, ref)))?.trim();
    if (loose !== undefined) return COMMIT.test(loose) ? loose : undefined;
  }
  for (const line of ((await readSmall(resolve(commonDirectory, "packed-refs"))) ?? "").split(
    "\n",
  )) {
    const [commit, name] = line.split(" ");
    if (name === ref && commit !== undefined && COMMIT.test(commit)) return commit;
  }
  return undefined;
}

/** A snapshot pins the observed commit. Blob digest comparison still rejects dirty former bytes. */
export async function repositorySnapshotGitHead(
  root: string,
  deadlineMs?: number,
): Promise<string | undefined> {
  const fromFiles = await gitHeadFromFiles(root);
  if (fromFiles !== undefined) return fromFiles;
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
  // Both start at once: the listing is only used once the probe confirmed a work tree, and a
  // listing that fails outside one is ignored. Sequential, the probe added its whole run time.
  // A listing whose result will not be used is stopped, so it never outlives the snapshot.
  const unused = new AbortController();
  const listing = execute(
    "git",
    ["-C", root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
    {
      timeout: gitTimeout(10_000, deadlineMs),
      maxBuffer: 64 * 1024 * 1024,
      signal: unused.signal,
    },
  );
  listing.catch(() => undefined);
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
    if (probe === null) {
      unused.abort();
      return { status: "available", paths: new Set() };
    }
    if (probe.stdout.trim() !== "true") {
      unused.abort();
      return { status: "unavailable" };
    }
    const { stdout } = await listing;
    return {
      status: "available",
      paths: new Set(stdout.split("\0").filter((path) => path.length > 0)),
    };
  } catch {
    unused.abort();
    return { status: "unavailable" };
  }
}
