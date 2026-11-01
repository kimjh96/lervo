import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assessWorkstreamFreshness,
  type WorkstreamFreshness,
  type WorkstreamFreshnessPolicy,
  type WorkstreamHeadDistance,
  type WorkstreamRepositoryHead,
} from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";

const execute = promisify(execFile);
const COMMIT = /^[a-f0-9]{40,64}$/u;

async function git(root: string, args: string[], maxBuffer = 4096): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    timeout: 5_000,
    maxBuffer,
  });
  return stdout.trim();
}

/** The repository HEAD observed at a workstream write; null outside Git or before a first commit. */
export async function observeRepositoryHead(
  root: string,
  observedAt: Date,
): Promise<WorkstreamRepositoryHead | null> {
  try {
    const commit = await git(root, ["rev-parse", "--verify", "HEAD"]);
    return COMMIT.test(commit) ? { commit, observedAt: observedAt.toISOString() } : null;
  } catch {
    return null;
  }
}

/**
 * Lervo's own knowledge commits and release preparation, and merge commits, carry no owner or agent
 * work, so they never age a workstream. Only other authored commits count toward staleness.
 */
const LERVO_AUTHOR_EMAILS = new Set([
  "knowledge@lervo.invalid",
  "lervo-release[bot]@users.noreply.github.com",
]);

/**
 * A recorded commit that is not an ancestor of the current HEAD (rewritten, reset, or unfetched
 * history) is unresolvable rather than zero commits behind, so it cannot look current.
 */
export async function measureWorkstreamHeadDistance(
  root: string,
  snapshot: Pick<WorkstreamSnapshot, "repositoryHead">,
): Promise<WorkstreamHeadDistance> {
  const recorded = snapshot.repositoryHead?.commit;
  if (recorded === undefined) return { status: "not_recorded" };
  try {
    await git(root, ["merge-base", "--is-ancestor", recorded, "HEAD"]);
    // A bounded window: past 1,000 counted commits the snapshot is stale under any policy.
    const authors = await git(
      root,
      ["log", "--no-merges", "--max-count=1000", "--format=%ae", `${recorded}..HEAD`],
      1000 * 256,
    );
    const count = authors
      .split("\n")
      .filter((email) => email !== "" && !LERVO_AUTHOR_EMAILS.has(email)).length;
    return Number.isSafeInteger(count) && count >= 0
      ? { status: "measured", commitsBehind: count }
      : { status: "unresolvable" };
  } catch {
    return { status: "unresolvable" };
  }
}

export async function observeWorkstreamFreshness(input: {
  root: string;
  snapshot: WorkstreamSnapshot;
  policy: WorkstreamFreshnessPolicy;
  observedAt: Date;
}): Promise<WorkstreamFreshness> {
  return assessWorkstreamFreshness({
    snapshot: input.snapshot,
    headDistance: await measureWorkstreamHeadDistance(input.root, input.snapshot),
    observedAt: input.observedAt,
    policy: input.policy,
  });
}
