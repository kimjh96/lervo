import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assessWorkstreamFreshness,
  type WorkstreamFreshness,
  type WorkstreamFreshnessPolicy,
  type WorkstreamHeadDistance,
  type WorkstreamRepositoryHead,
} from "@lervo/repository-knowledge";
import { repositorySnapshotGitHead } from "@lervo/orchestrator";
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
 * Measured distances by checkout, recorded commit, and HEAD commit. Commits never change, so a
 * measurement holds while both stay the same; a long-lived process, such as the context server,
 * then answers each prompt without running Git. An unresolvable distance is not kept: fetching the
 * missing history can resolve it.
 */
const measuredDistances = new Map<string, WorkstreamHeadDistance>();
const MEASURED_DISTANCE_LIMIT = 64;

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
  // HEAD's commit, read from Git's files when it can be; Git compares against that same commit.
  const head = await repositorySnapshotGitHead(root);
  const key = head === undefined ? undefined : `${root}\0${recorded}\0${head}`;
  const known = key === undefined ? undefined : measuredDistances.get(key);
  if (known !== undefined) return known;
  const distance = await measureHeadDistance(root, recorded, head ?? "HEAD");
  if (key !== undefined && distance.status === "measured") {
    if (measuredDistances.size >= MEASURED_DISTANCE_LIMIT)
      measuredDistances.delete(measuredDistances.keys().next().value!);
    measuredDistances.set(key, distance);
  }
  return distance;
}

async function measureHeadDistance(
  root: string,
  recorded: string,
  head: string,
): Promise<WorkstreamHeadDistance> {
  try {
    await git(root, ["merge-base", "--is-ancestor", recorded, head]);
    // One line per author with its commit count, so the output stays bounded however long the
    // range is, and recent Lervo commits never hide earlier work.
    const authors = await git(
      root,
      ["shortlog", "--summary", "--numbered", "--email", "--no-merges", `${recorded}..${head}`],
      256 * 1024,
    );
    let count = 0;
    for (const line of authors.split("\n")) {
      const match = /^\s*(\d+)\s+.*<([^>]*)>\s*$/u.exec(line);
      if (match !== null && !LERVO_AUTHOR_EMAILS.has(match[2]!)) count += Number(match[1]);
    }
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
