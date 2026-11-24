// Where a new hosted workspace starts (Lervo ADE sessions, "The workspace's base"). The owner's
// checked-out default branch is their working copy and may trail its upstream by many commits,
// because Lervo's knowledge commits land there and nothing pulls it. New work therefore starts
// from the fetched upstream tip and carries along the knowledge commits the resident has not
// published yet, counted as the resident counts them. The owner's branch never moves.
import { unpublishedKnowledgeCommits } from "@lervo/repository-knowledge-runtime";

import { runGit } from "./workspace-base-git.js";

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
  "base_unresolved" | "no_upstream" | "fetch_failed" | "knowledge_state_unreadable";

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
   * Why the workspace starts without something. `base_unresolved` starts from the caller's
   * fallback commit; `no_upstream` and `fetch_failed` start from the local tip;
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
      notice: "base_unresolved",
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

const exists = (root: string, ref: string) =>
  runGit(root, ["rev-parse", "--verify", "--quiet", ref]).then(
    () => true,
    () => false,
  );

/**
 * The repository's default branch, never a guess: the default a remote advertises (`origin`
 * first), else a local `main` or `master`, else the only local branch that follows a remote
 * branch. Anything else, such as a feature branch beside an unknown default, names none, and the
 * workspace starts from the checked-out commit instead.
 */
export async function defaultBranchOf(root: string): Promise<string> {
  const remotes = (await runGit(root, ["remote"]).catch(() => ""))
    .split("\n")
    .filter((remote) => remote !== "");
  for (const remote of [...remotes.filter((name) => name === "origin"), ...remotes]) {
    const head = await runGit(root, [
      "symbolic-ref",
      "--quiet",
      "--short",
      `refs/remotes/${remote}/HEAD`,
    ]).catch(() => "");
    const branch = head.startsWith(`${remote}/`) ? head.slice(remote.length + 1) : "";
    if (branch !== "" && (await exists(root, `refs/heads/${branch}`))) return branch;
  }
  for (const candidate of ["main", "master"])
    if (await exists(root, `refs/heads/${candidate}`)) return candidate;
  const tracking = (
    await runGit(root, ["for-each-ref", "--format=%(refname:short)%09%(upstream)", "refs/heads"])
  )
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([, upstream]) => upstream !== undefined && upstream !== "")
    .map(([branch]) => branch!);
  if (tracking.length === 1) return tracking[0]!;
  throw new Error("The repository names no default branch.");
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
