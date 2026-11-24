// Where a new hosted workspace starts (Lervo ADE sessions, "The workspace's base"). The owner's
// checked-out default branch is their working copy and may trail its upstream by many commits,
// because Lervo's effect commits land there and nothing pulls it. New work therefore starts from
// the fetched upstream tip, and it carries along only the Lervo effect commits that upstream does
// not have yet. The owner's branch never moves.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveDefaultBranch } from "./workstream-branch-selection.js";

const execute = promisify(execFile);

/** The author of Lervo's own effect commits (`@lervo/repository-knowledge-runtime`). */
export const LERVO_EFFECT_AUTHOR = "knowledge@lervo.invalid";
/** How long a fetch may take before the workspace starts from the local tip instead. */
const FETCH_TIMEOUT_MS = 20_000;

/** Where a workspace starts, and why. */
export interface WorkspaceBase {
  /** The commit the workspace branch is created at, before any replayed effect commit. */
  readonly commit: string;
  /** `upstream` after a fetch, `local` when there is no upstream or the fetch failed. */
  readonly source: "upstream" | "local";
  /** The upstream ref, such as `origin/main`, or null without one. */
  readonly upstream: string | null;
  /** Unpublished Lervo effect commits to replay on the workspace branch, oldest first. */
  readonly replay: readonly string[];
  /** Why the workspace starts from the local tip: `no_upstream` or `fetch_failed`. */
  readonly notice: "no_upstream" | "fetch_failed" | null;
}

/** A commit on the local branch that upstream lacks. */
export interface LocalCommit {
  readonly commit: string;
  readonly authorEmail: string;
  readonly effect: boolean;
}

/** The Git reads `chooseWorkspaceBase` needs, behind a port so the decision is testable. */
export interface WorkspaceBaseGit {
  defaultBranch(): Promise<string>;
  commitOf(ref: string): Promise<string>;
  /** The branch's upstream, such as `origin/main`, or null. */
  upstreamOf(branch: string): Promise<string | null>;
  /** Fetches the upstream ref; false when the fetch failed or timed out. */
  fetch(upstream: string): Promise<boolean>;
  /** Commits reachable from `tip` but not from `base`, oldest first. */
  commitsBetween(base: string, tip: string): Promise<readonly LocalCommit[]>;
  /** Whether every path `commit` changed already has the same content at `base`. */
  carriedBy(base: string, commit: string): Promise<boolean>;
}

/** Whether a commit is one of Lervo's own effect commits, which any workspace may carry. */
export function isEffectCommit(commit: LocalCommit): boolean {
  return commit.effect && commit.authorEmail === LERVO_EFFECT_AUTHOR;
}

/**
 * Chooses where a new workspace starts: the fetched upstream tip of the default branch, with the
 * unpublished Lervo effect commits whose changes upstream does not carry yet. Without an upstream,
 * or when the fetch fails, it starts from the local tip and says why; credentials are a notice,
 * never a stop.
 */
export async function chooseWorkspaceBase(git: WorkspaceBaseGit): Promise<WorkspaceBase> {
  const branch = await git.defaultBranch();
  const local = await git.commitOf(branch);
  const upstream = await git.upstreamOf(branch);
  if (upstream === null)
    return { commit: local, source: "local", upstream: null, replay: [], notice: "no_upstream" };
  if (!(await git.fetch(upstream)))
    return { commit: local, source: "local", upstream, replay: [], notice: "fetch_failed" };
  const tip = await git.commitOf(upstream);
  const replay: string[] = [];
  for (const commit of await git.commitsBetween(tip, local))
    if (isEffectCommit(commit) && !(await git.carriedBy(tip, commit.commit)))
      replay.push(commit.commit);
  return { commit: tip, source: "upstream", upstream, replay, notice: null };
}

async function git(root: string, arguments_: string[], timeout?: number): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...(timeout === undefined ? {} : { timeout }),
  });
  return stdout.trim();
}

async function optionalGit(root: string, arguments_: string[]): Promise<string | null> {
  try {
    return await git(root, arguments_);
  } catch {
    return null;
  }
}

/** The blob at `path` in `commit`, or null when the path does not exist there. */
function blobAt(root: string, commit: string, path: string): Promise<string | null> {
  return optionalGit(root, ["rev-parse", "--verify", "--quiet", `${commit}:${path}`]);
}

/** The Git reads of `chooseWorkspaceBase` in the repository at `root`. */
export function gitWorkspaceBase(root: string): WorkspaceBaseGit {
  return {
    defaultBranch: () => resolveDefaultBranch(root, "HEAD"),
    commitOf: (ref) => git(root, ["rev-parse", "--verify", `${ref}^{commit}`]),
    upstreamOf: (branch) =>
      optionalGit(root, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        `${branch}@{upstream}`,
      ]),
    async fetch(upstream) {
      const slash = upstream.indexOf("/");
      if (slash <= 0) return false;
      try {
        // Fetching updates only the remote-tracking ref; the local branch stays where it is.
        await git(
          root,
          ["fetch", "--quiet", "--no-tags", upstream.slice(0, slash), upstream.slice(slash + 1)],
          FETCH_TIMEOUT_MS,
        );
        return true;
      } catch {
        return false;
      }
    },
    async commitsBetween(base, tip) {
      const log = await git(root, [
        "log",
        "--reverse",
        "--no-merges",
        "--format=%H%x1f%ae%x1f%(trailers:key=Lervo-Effect,valueonly,separator=%x1d)%x1e",
        `${base}..${tip}`,
      ]);
      return log
        .split("\x1e")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
        .map((entry) => {
          const [commit = "", authorEmail = "", effect = ""] = entry.split("\x1f");
          return { commit, authorEmail, effect: effect.trim() !== "" };
        });
    },
    async carriedBy(base, commit) {
      const paths = (
        await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commit])
      )
        .split("\n")
        .filter((path) => path !== "");
      for (const path of paths)
        if ((await blobAt(root, commit, path)) !== (await blobAt(root, base, path))) return false;
      return true;
    },
  };
}
