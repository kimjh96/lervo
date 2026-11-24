// Whether retiring may delete a hosted workspace's branch (Lervo ADE sessions, "Retiring a
// workspace"): only when nothing on it is missing from the owner's default branch or its upstream.
import { resolveDefaultBranch } from "./workstream-branch-selection.js";
import { runGit } from "./workspace-base-git.js";
import { trackingRef, upstreamOf } from "./workspace-base.js";

const isAncestor = (root: string, commit: string, of: string) =>
  runGit(root, ["merge-base", "--is-ancestor", commit, of]).then(
    () => true,
    () => false,
  );

/** The commits in `limit..tip` whose patch `against` also holds, by `git cherry`. */
async function copiesIn(root: string, against: string, tip: string, limit: string) {
  const lines = (await runGit(root, ["cherry", against, tip, limit])).split("\n");
  return new Set(lines.filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim()));
}

/**
 * Whether the default branch already holds every change of `branch`. The branch's tip must be in
 * the local default branch or its upstream, or every commit beyond the upstream must be a copy:
 * a commit whose patch the local default branch or the upstream also holds, such as a knowledge
 * commit a workspace replayed when it started. A merge counts as work, because its change has no
 * patch to compare. A commit made in the workspace, even by Lervo, keeps the branch.
 */
export async function branchMergedIntoDefault(root: string, branch: string): Promise<boolean> {
  const tip = `refs/heads/${branch}`;
  const defaultBranch = await resolveDefaultBranch(root, "HEAD");
  const local = `refs/heads/${defaultBranch}`;
  if (await isAncestor(root, tip, local)) return true;
  const upstream = await upstreamOf(root, defaultBranch);
  if (upstream === null) return false;
  const remote = trackingRef(upstream);
  const present = await runGit(root, ["rev-parse", "--verify", "--quiet", remote]).then(
    () => true,
    () => false,
  );
  if (!present) return false;
  if (await isAncestor(root, tip, remote)) return true;
  if ((await runGit(root, ["rev-list", "--merges", `${remote}..${tip}`])) !== "") return false;
  const ahead = (await runGit(root, ["rev-list", `${remote}..${tip}`]))
    .split("\n")
    .filter((commit) => commit !== "");
  const inLocal = await copiesIn(root, local, tip, remote);
  const inUpstream = await copiesIn(root, remote, tip, remote);
  return ahead.every((commit) => inLocal.has(commit) || inUpstream.has(commit));
}
