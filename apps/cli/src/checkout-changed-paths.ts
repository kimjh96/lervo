// What a conversation's checkout changed (Lervo ADE coordination, "Reconciliation"): committed,
// staged, and unstaged changes, and untracked paths Git does not ignore, measured from where the
// branch last met its integration target, so changes merged in from upstream never count as the
// conversation's. The core decides which of them a claim may name.
import { execFile, spawn } from "node:child_process";

import { repositoryCoordinateDigest } from "@lervo/project-storage";

const GIT_TIMEOUT_MS = 2_000;
/** Enough for well past 10,000 paths of ordinary length; a larger listing fails as unavailable. */
const MAXIMUM_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const COMMIT = /^[a-f0-9]{40,64}$/u;
/**
 * The most untracked files listed one by one: the bound of a generation's changed paths. Past it,
 * the listing falls back to whole untracked directories, which the core's coalescing then fits.
 */
const MAXIMUM_UNTRACKED_FILES = 10_000;
/** Variables that would point Git at another repository, index, or object store. */
const REDIRECTING_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

/** The process environment without redirecting variables, and with optional locks off. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of REDIRECTING_VARIABLES) delete environment[name];
  // A read never takes the index lock to refresh it, so it never races the agent's own Git.
  environment.GIT_OPTIONAL_LOCKS = "0";
  return environment;
}

function git(worktree: string, args: readonly string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["--no-optional-locks", "-C", worktree, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
        env: gitEnvironment(),
        encoding: "utf8",
      },
      (error, stdout) => resolve(error === null ? stdout : null),
    );
  });
}

function fields(output: string): string[] {
  return output.split("\0").filter((path) => path !== "");
}

/**
 * Each untracked file Git does not ignore, streamed from `git ls-files --others`, or `undefined`
 * when the listing passes `MAXIMUM_UNTRACKED_FILES` or `timeoutMs` first, and null when Git fails.
 * It stops Git as soon as it gives up, so a huge untracked tree costs at most its budget.
 */
function untrackedFiles(worktree: string, timeoutMs: number): Promise<string[] | undefined | null> {
  return new Promise((resolve) => {
    if (timeoutMs <= 0) {
      resolve(undefined);
      return;
    }
    const child = spawn(
      "git",
      ["--no-optional-locks", "-C", worktree, "ls-files", "--others", "--exclude-standard", "-z"],
      { env: gitEnvironment(), stdio: ["ignore", "pipe", "ignore"] },
    );
    const paths: string[] = [];
    let pending = "";
    let settled = false;
    const finish = (value: string[] | undefined | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const parts = (pending + chunk).split("\0");
      pending = parts.pop() ?? "";
      for (const path of parts) if (path !== "") paths.push(path);
      if (paths.length > MAXIMUM_UNTRACKED_FILES) finish(undefined);
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 && pending === "" ? paths : null));
  });
}

/**
 * The untracked paths Git does not ignore: each file, so a new file in a new directory holds only
 * itself. A listing past the file bound, or one that would spend more than half the time left,
 * falls back to `--directory`, where an untracked directory counts once, as the directory.
 */
async function untrackedPaths(worktree: string, remaining: () => number): Promise<string[] | null> {
  const files = await untrackedFiles(worktree, Math.floor(remaining() / 2));
  if (files !== undefined) return files;
  if (remaining() <= 0) return null;
  const listed = await git(
    worktree,
    ["ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory", "-z"],
    remaining(),
  );
  return listed === null ? null : fields(listed).map((path) => path.replace(/\/+$/u, ""));
}

/**
 * The integration target the generation's digest names, as `refs/heads/<branch>`, and its
 * configured upstream, if any; null when no local branch is the target.
 */
async function targetRefs(
  worktree: string,
  input: ChangedPathsInput,
  timeoutMs: number,
): Promise<{ ref: string; upstream: string | null } | null> {
  const listed = await git(
    worktree,
    ["for-each-ref", "--format=%(refname)%00%(upstream)", "refs/heads"],
    timeoutMs,
  );
  for (const line of (listed ?? "").split("\n")) {
    const [ref, upstream] = line.split("\0");
    if (ref !== undefined && repositoryCoordinateDigest(ref) === input.integrationTargetDigest)
      return { ref, upstream: upstream === undefined || upstream === "" ? null : upstream };
  }
  return null;
}

/**
 * Where the branch last met its target: the merge base of `HEAD` with the generation's base, the
 * target, and its upstream, so it never falls before the base. An upstream that is configured but
 * gone fails the merge base, which then runs without it; when that fails too, the base stands.
 * Without a target branch it is the merge base with the base alone.
 */
async function measuredFrom(
  worktree: string,
  input: ChangedPathsInput,
  remaining: () => number,
): Promise<string> {
  const target = await targetRefs(worktree, input, remaining());
  const attempts =
    target === null
      ? [[]]
      : target.upstream === null
        ? [[target.ref]]
        : [[target.ref, target.upstream], [target.ref]];
  for (const refs of attempts) {
    if (remaining() <= 0) break;
    const base = (
      await git(worktree, ["merge-base", "HEAD", input.baseCommit, ...refs], remaining())
    )?.trim();
    if (base !== undefined && COMMIT.test(base)) return base;
  }
  return input.baseCommit;
}

export interface ChangedPathsInput {
  /** The generation's recorded base. */
  readonly baseCommit: string;
  /** The digest of the generation's integration target ref, `refs/heads/<branch>`. */
  readonly integrationTargetDigest: string;
  /** On the `performance.now()` clock; each Git call is bounded by the time left. */
  readonly deadline: number;
}

/**
 * The repository-relative paths `worktree` changed, sorted, and the commit they are measured
 * from, or null when Git could not list them in time. The commit is the merge base of `HEAD` with
 * the generation's base and the integration target with its upstream, so a merge or rebase onto
 * upstream adds nothing. With no local branch as the target, it is the merge base with the base,
 * which is the base itself unless a rebase left it behind. Renames count
 * as their source and their target. Untracked files count one by one, up to the file bound.
 */
export async function listCheckoutChangedPaths(
  worktree: string,
  input: ChangedPathsInput,
): Promise<{ paths: string[]; measuredFrom: string } | null> {
  const remaining = () => Math.min(GIT_TIMEOUT_MS, Math.floor(input.deadline - performance.now()));
  if (!COMMIT.test(input.baseCommit) || remaining() <= 0) return null;
  const from = await measuredFrom(worktree, input, remaining);
  if (remaining() <= 0) return null;
  const [tracked, untracked] = await Promise.all([
    git(worktree, ["diff", "--name-only", "--no-renames", "-z", from, "--"], remaining()),
    untrackedPaths(worktree, remaining),
  ]);
  if (tracked === null || untracked === null) return null;
  const paths = [...fields(tracked), ...untracked];
  return { paths: [...new Set(paths)].sort(), measuredFrom: from };
}
