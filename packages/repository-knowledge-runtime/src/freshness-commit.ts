import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
  knowledgeOutputCommitSafe,
} from "./knowledge-output-commit.js";

const execute = promisify(execFile);

async function git(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    maxBuffer: 16 * 1024 * 1024,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  return stdout;
}

/** The bytes a path holds at `HEAD`, or null when it is absent there. */
export async function committedBlob(root: string, path: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", `HEAD:${path}`], {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Commits exactly `paths` as `Lervo Knowledge` with the freshness trailer, leaving any other
 * staged or unstaged work untouched. Returns null when committing is unsafe or a concurrent Git
 * operation wins; the written bytes stay and the event records `commitHash: null`.
 */
export async function commitFreshnessPaths(input: {
  repositoryRoot: string;
  paths: readonly string[];
  subject: string;
  trailer: { key: "Lervo-Freshness-Candidate" | "Lervo-Freshness-Revert"; candidateId: string };
}): Promise<string | null> {
  const root = input.repositoryRoot;
  if (input.paths.length === 0 || !(await knowledgeOutputCommitSafe(root))) return null;
  try {
    const before = (await git(root, ["rev-parse", "HEAD"])).trim();
    await git(root, ["add", "-A", "--", ...input.paths]);
    await git(
      root,
      [
        "commit",
        "--only",
        "--quiet",
        "-m",
        input.subject,
        "-m",
        `${input.trailer.key}: ${input.trailer.candidateId}`,
        "--",
        ...input.paths,
      ],
      KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
    );
    const after = (await git(root, ["rev-parse", "HEAD"])).trim();
    const parent = (await git(root, ["rev-parse", `${after}^`])).trim();
    return parent === before ? after : null;
  } catch {
    return null;
  }
}
