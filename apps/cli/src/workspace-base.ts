// Where a new hosted workspace starts (Lervo ADE sessions, "The workspace's base"). The owner's
// checked-out default branch is their working copy and may trail its upstream by many commits,
// because Lervo's knowledge commits land there and nothing pulls it. New work therefore starts
// from the fetched upstream tip and carries along the knowledge commits the resident has not
// published yet, counted as the resident counts them. The owner's branch never moves.
import { unpublishedKnowledgeCommits } from "@lervo/repository-knowledge-runtime";

import { runGit } from "./workspace-base-git.js";
import { observeCheckedOutBranch, resolveDefaultBranch } from "./workstream-branch-selection.js";

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

/** Why a workspace starts without something; see `WorkspaceBase.notice`. */
export type WorkspaceBaseNotice =
  "default_branch_unresolved" | "no_upstream" | "fetch_failed" | "knowledge_state_unreadable";

/** Where a workspace starts, and why. */
export interface WorkspaceBase {
  /** The commit the workspace branch is created at, before any replayed commit. */
  readonly commit: string;
  /** `upstream` after a fetch, `local` otherwise. */
  readonly source: "upstream" | "local";
  /** The upstream, such as `origin/main`, or null without one. */
  readonly upstream: string | null;
  /** Unpublished knowledge commits to replay on the workspace branch, in their order. */
  readonly replay: readonly string[];
  /**
   * Why the workspace starts without something. `default_branch_unresolved` starts from the
   * caller's fallback commit; `no_upstream` and `fetch_failed` start from the local tip;
   * `knowledge_state_unreadable` starts from the upstream tip and replays nothing.
   */
  readonly notice: WorkspaceBaseNotice | null;
}

/** The Git reads `chooseWorkspaceBase` needs, behind a port so the decision is testable. */
export interface WorkspaceBaseGit {
  /** The default branch's name; throws when the repository names none. */
  defaultBranch(): Promise<string>;
  commitOf(ref: string): Promise<string>;
  /** The branch's upstream, or null; a branch that follows a local branch has none. */
  upstreamOf(branch: string): Promise<Upstream | null>;
  /** Fetches the upstream into its remote-tracking ref; throws when it fails or times out. */
  fetch(upstream: Upstream): Promise<void>;
  /**
   * The resident's unpublished knowledge commits on the default branch `branch`; null when it
   * cannot say which commits a person declined or a merge published.
   */
  unpublished(upstream: Upstream, branch: string): Promise<readonly string[] | null>;
}

/**
 * Chooses where a new workspace starts: the fetched upstream tip of the default branch, with the
 * resident's unpublished knowledge commits on that branch. Every one is replayed in order, so a
 * later commit that undoes part of an earlier one, such as the resident's repair, still undoes it;
 * a pick that adds nothing is recorded as carried. Without a default branch it starts from
 * `fallback`; without an upstream, or when any step after resolving it fails, from the local tip.
 * Each case says why, and credentials are a notice, never a stop.
 */
export async function chooseWorkspaceBase(
  git: WorkspaceBaseGit,
  fallback: string,
): Promise<WorkspaceBase> {
  let branch: string;
  let local: string;
  try {
    branch = await git.defaultBranch();
    local = await git.commitOf(`refs/heads/${branch}`);
  } catch {
    return {
      commit: fallback,
      source: "local",
      upstream: null,
      replay: [],
      notice: "default_branch_unresolved",
    };
  }
  const upstream = await git.upstreamOf(branch).catch(() => null);
  if (upstream === null)
    return { commit: local, source: "local", upstream: null, replay: [], notice: "no_upstream" };
  const name = `${upstream.remote}/${upstream.branch}`;
  try {
    await git.fetch(upstream);
    const tip = await git.commitOf(trackingRef(upstream));
    const unpublished = await git.unpublished(upstream, branch);
    return unpublished === null
      ? {
          commit: tip,
          source: "upstream",
          upstream: name,
          replay: [],
          notice: "knowledge_state_unreadable",
        }
      : { commit: tip, source: "upstream", upstream: name, replay: unpublished, notice: null };
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

/**
 * The repository's default branch: the remote's default, else `main` or `master`, else the
 * checked-out branch. A detached checkout with none of them names no default branch.
 */
export async function defaultBranchOf(root: string): Promise<string> {
  const checkedOut = await observeCheckedOutBranch(root);
  const branch = await resolveDefaultBranch(root, checkedOut ?? "HEAD");
  if (branch === "HEAD") throw new Error("The repository names no default branch.");
  return branch;
}

/** The Git reads of `chooseWorkspaceBase` in the repository at `root`. */
export function gitWorkspaceBase(root: string): WorkspaceBaseGit {
  return {
    defaultBranch: () => defaultBranchOf(root),
    commitOf: (ref) => runGit(root, ["rev-parse", "--verify", `${ref}^{commit}`]),
    upstreamOf: (branch) => upstreamOf(root, branch),
    async fetch(upstream) {
      // An explicit refspec updates only the remote-tracking ref, whatever `remote.*.fetch` says;
      // the local branch stays where it is, and Git starts no maintenance in the owner's checkout.
      await runGit(
        root,
        [
          "-c",
          "maintenance.auto=false",
          "fetch",
          "--quiet",
          "--no-tags",
          "--no-write-fetch-head",
          upstream.remote,
          `+refs/heads/${upstream.branch}:${trackingRef(upstream)}`,
        ],
        { timeout: FETCH_TIMEOUT_MS },
      );
    },
    unpublished: (upstream, branch) =>
      unpublishedKnowledgeCommits(root, upstream, `refs/heads/${branch}`),
  };
}
