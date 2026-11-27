// What a conversation's checkout changed (Lervo ADE coordination, "Reconciliation"): committed,
// staged, and unstaged changes, and untracked paths Git does not ignore, measured from where the
// branch last met its integration target, so changes merged in from upstream never count as the
// conversation's. The core decides which of them a claim may name.
import { execFile } from "node:child_process";

import { repositoryCoordinateDigest } from "@lervo/project-storage";

const GIT_TIMEOUT_MS = 2_000;
/** Enough for well past 10,000 paths of ordinary length; a larger listing fails as unavailable. */
const MAXIMUM_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const COMMIT = /^[a-f0-9]{40,64}$/u;
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
 * The commits the branch is measured against: the local branch whose ref the generation's
 * integration target digest names, and its upstream, or the generation's base alone when no
 * branch matches.
 */
async function targetCommits(
  worktree: string,
  input: ChangedPathsInput,
  timeoutMs: number,
): Promise<string[]> {
  const listed = await git(
    worktree,
    ["for-each-ref", "--format=%(refname)%00%(upstream)", "refs/heads"],
    timeoutMs,
  );
  for (const line of (listed ?? "").split("\n")) {
    const [ref, upstream] = line.split("\0");
    if (ref !== undefined && repositoryCoordinateDigest(ref) === input.integrationTargetDigest)
      return upstream === undefined || upstream === "" ? [ref] : [ref, upstream];
  }
  return [input.baseCommit];
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
 * from, or null when Git could not list them in time. The commit is the merge base of `HEAD` and
 * the integration target with its upstream, so a merge or rebase onto upstream adds nothing; it
 * is the merge base with the generation's base when no local branch is the target. Renames count
 * as their source and their target. An untracked directory counts once, as the directory.
 */
export async function listCheckoutChangedPaths(
  worktree: string,
  input: ChangedPathsInput,
): Promise<{ paths: string[]; measuredFrom: string } | null> {
  const remaining = () => Math.min(GIT_TIMEOUT_MS, Math.floor(input.deadline - performance.now()));
  if (!COMMIT.test(input.baseCommit) || remaining() <= 0) return null;
  const targets = await targetCommits(worktree, input, remaining());
  const base = (await git(worktree, ["merge-base", "HEAD", ...targets], remaining()))?.trim();
  const measuredFrom = base !== undefined && COMMIT.test(base) ? base : input.baseCommit;
  if (remaining() <= 0) return null;
  const [tracked, untracked] = await Promise.all([
    git(worktree, ["diff", "--name-only", "--no-renames", "-z", measuredFrom, "--"], remaining()),
    git(
      worktree,
      ["ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory", "-z"],
      remaining(),
    ),
  ]);
  if (tracked === null || untracked === null) return null;
  const paths = [...fields(tracked), ...fields(untracked).map((path) => path.replace(/\/+$/u, ""))];
  return { paths: [...new Set(paths)].sort(), measuredFrom };
}
