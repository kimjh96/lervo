import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CONVERGENCE_HOST_TRAILER } from "./convergence-owner-fence.js";
import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";

const execute = promisify(execFile);
const HASH = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_SCANNED_COMMITS = 64;

/**
 * Knowledge-output commits reachable from `HEAD` within the window whose host trailer names a
 * different host. Bounded by count and time; an unborn or unreadable history reports none.
 */
export async function foreignKnowledgeCommits(input: {
  repositoryRoot: string;
  hostHash: string;
  since: number;
  /** The history to read; `@{upstream}` reads the last fetch of the branch's upstream. */
  revision?: "HEAD" | "@{upstream}";
}): Promise<{ hostHash: string; committedAt: number }[]> {
  let stdout: string;
  try {
    ({ stdout } = await execute(
      "git",
      [
        "-C",
        input.repositoryRoot,
        "log",
        `--max-count=${MAXIMUM_SCANNED_COMMITS}`,
        `--since=${Math.floor(input.since / 1_000)}`,
        `--author=${KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email}`,
        `--format=%ct%x09%(trailers:key=${CONVERGENCE_HOST_TRAILER},valueonly,separator=%x2C)`,
        input.revision ?? "HEAD",
        "--",
      ],
      { maxBuffer: 1024 * 1024 },
    ));
  } catch {
    return [];
  }
  const commits: { hostHash: string; committedAt: number }[] = [];
  for (const line of stdout.split("\n")) {
    const [time, trailer] = line.split("\t");
    const committedAt = Number(time) * 1_000;
    if (!Number.isSafeInteger(committedAt) || trailer === undefined) continue;
    for (const value of trailer.split(",").map((item) => item.trim())) {
      if (HASH.test(value) && value !== input.hostHash)
        commits.push({ hostHash: value, committedAt });
    }
  }
  return commits;
}

/** How far back another host's knowledge commits mean it maintains the project too (ADR-0656). */
export const STANDALONE_PEER_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * ADR-0656: the other hosts whose knowledge commits reached this checkout's branch or its upstream's
 * last fetch within the window. Reads local history only; it never fetches.
 */
export async function standalonePeerHosts(input: {
  repositoryRoot: string;
  hostHash: string;
  now: number;
}): Promise<string[]> {
  const since = input.now - STANDALONE_PEER_WINDOW_MS;
  const commits = (
    await Promise.all(
      (["HEAD", "@{upstream}"] as const).map((revision) =>
        foreignKnowledgeCommits({ ...input, since, revision }),
      ),
    )
  ).flat();
  return [...new Set(commits.map((commit) => commit.hostHash))].sort();
}
