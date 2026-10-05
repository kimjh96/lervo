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
        "HEAD",
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
