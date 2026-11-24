// Where a new hosted workspace starts (Lervo ADE sessions, "The workspace's base"). The owner's
// checked-out default branch is their working copy and may trail its upstream by many commits,
// because Lervo's knowledge commits land there and nothing pulls it. New work therefore starts
// from the fetched upstream tip and carries along the knowledge commits the resident has not
// published yet, counted as the resident counts them. The owner's branch never moves.
import { unpublishedKnowledgeCommits } from "@lervo/repository-knowledge-runtime";

import { runGit } from "./workspace-base-git.js";
import { resolveDefaultBranch } from "./workstream-branch-selection.js";

/** How long a fetch may take before the workspace starts from the local tip instead. */
const FETCH_TIMEOUT_MS = 20_000;

/** The remote branch a local branch follows, such as `main` on `origin`. */
export interface Upstream {
  readonly remote: string;
  /** The branch's name on the remote, without `refs/heads/`. */
  readonly branch: string;
}

/** The remote-tracking ref an upstream is fetched into. */
export const trackingRef = (upstream: Upstream) =>
  `refs/remotes/${upstream.remote}/${upstream.branch}`;

/** Where a workspace starts, and why. */
export interface WorkspaceBase {
  /** The commit the workspace branch is created at, before any replayed commit. */
  readonly commit: string;
  /** `upstream` after a fetch, `local` when there is no upstream or the upstream path failed. */
  readonly source: "upstream" | "local";
  /** The upstream, such as `origin/main`, or null without one. */
  readonly upstream: string | null;
  /** Unpublished knowledge commits to replay on the workspace branch, oldest first. */
  readonly replay: readonly string[];
  /**
   * Why the workspace starts without something: `no_upstream` and `fetch_failed` start from the
   * local tip; `knowledge_state_unreadable` starts from the upstream tip and replays nothing.
   */
  readonly notice: "no_upstream" | "fetch_failed" | "knowledge_state_unreadable" | null;
}

/** The Git reads `chooseWorkspaceBase` needs, behind a port so the decision is testable. */
export interface WorkspaceBaseGit {
  defaultBranch(): Promise<string>;
  commitOf(ref: string): Promise<string>;
  /** The branch's upstream, or null; a branch that follows a local branch has none. */
  upstreamOf(branch: string): Promise<Upstream | null>;
  /** Fetches the upstream into its remote-tracking ref; throws when it fails or times out. */
  fetch(upstream: Upstream): Promise<void>;
  /** The resident's unpublished knowledge commits; null when its state cannot be read. */
  unpublished(upstream: Upstream): Promise<readonly string[] | null>;
  /** Whether `base` already holds every change `commit` made, bytes and modes alike. */
  carriedBy(base: string, commit: string): Promise<boolean>;
}

/**
 * Chooses where a new workspace starts: the fetched upstream tip of the default branch, with the
 * unpublished knowledge commits whose changes that tip lacks. Without an upstream, or when any
 * step after resolving it fails, it starts from the local tip and says why; credentials are a
 * notice, never a stop.
 */
export async function chooseWorkspaceBase(git: WorkspaceBaseGit): Promise<WorkspaceBase> {
  const branch = await git.defaultBranch();
  const local = await git.commitOf(`refs/heads/${branch}`);
  const upstream = await git.upstreamOf(branch).catch(() => null);
  if (upstream === null)
    return { commit: local, source: "local", upstream: null, replay: [], notice: "no_upstream" };
  const name = `${upstream.remote}/${upstream.branch}`;
  try {
    await git.fetch(upstream);
    const tip = await git.commitOf(trackingRef(upstream));
    const unpublished = await git.unpublished(upstream);
    if (unpublished === null)
      return {
        commit: tip,
        source: "upstream",
        upstream: name,
        replay: [],
        notice: "knowledge_state_unreadable",
      };
    const replay: string[] = [];
    for (const commit of unpublished) if (!(await git.carriedBy(tip, commit))) replay.push(commit);
    return { commit: tip, source: "upstream", upstream: name, replay, notice: null };
  } catch {
    return { commit: local, source: "local", upstream: name, replay: [], notice: "fetch_failed" };
  }
}

/** The branch's upstream from `branch.<name>.remote` and `.merge`; `.` names a local branch. */
export async function upstreamOf(root: string, branch: string): Promise<Upstream | null> {
  const read = (key: string) =>
    runGit(root, ["config", "--get", `branch.${branch}.${key}`]).catch(() => "");
  const remote = await read("remote");
  const merge = await read("merge");
  if (remote === "" || remote === "." || !merge.startsWith("refs/heads/")) return null;
  return { remote, branch: merge.slice("refs/heads/".length) };
}

/** The Git reads of `chooseWorkspaceBase` in the repository at `root`. */
export function gitWorkspaceBase(root: string): WorkspaceBaseGit {
  return {
    defaultBranch: () => resolveDefaultBranch(root, "HEAD"),
    commitOf: (ref) => runGit(root, ["rev-parse", "--verify", `${ref}^{commit}`]),
    upstreamOf: (branch) => upstreamOf(root, branch),
    async fetch(upstream) {
      // An explicit refspec updates only the remote-tracking ref, whatever `remote.*.fetch` says;
      // the local branch stays where it is.
      await runGit(
        root,
        [
          "fetch",
          "--quiet",
          "--no-tags",
          upstream.remote,
          `+refs/heads/${upstream.branch}:${trackingRef(upstream)}`,
        ],
        { timeout: FETCH_TIMEOUT_MS },
      );
    },
    unpublished: (upstream) => unpublishedKnowledgeCommits(root, upstream),
    async carriedBy(base, commit) {
      const paths = (
        await runGit(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit], {
          raw: true,
        })
      )
        .split("\0")
        .filter((path) => path !== "");
      if (paths.length === 0) return true;
      // Git exits 1 for a difference; any other failure is an error, never an answer.
      return runGit(root, ["diff", "--quiet", "--no-renames", base, commit, "--", ...paths]).then(
        () => true,
        (error: unknown) => {
          if ((error as { code?: unknown }).code === 1) return false;
          throw error;
        },
      );
    },
  };
}
