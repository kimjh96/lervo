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

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    timeout: 5_000,
    maxBuffer: 4096,
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
    const count = Number(await git(root, ["rev-list", "--count", `${recorded}..HEAD`]));
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
