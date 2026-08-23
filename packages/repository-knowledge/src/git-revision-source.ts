import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const GIT_REVISION_SOURCE_ADAPTER = "git-head-revision-v1+git-rev-parse";
export const GIT_REVISION_SOURCE_PATH = "@git/HEAD";

const executeFile = promisify(execFile);
const fullObjectName = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\n?$/u;

export type GitRevisionObservation =
  | { status: "observed"; content: string }
  | { status: "unavailable"; reason: "git_head_unavailable" };

export type ObserveGitRevision = (repositoryRoot: string) => Promise<GitRevisionObservation>;

export const observeGitHeadRevision: ObserveGitRevision = async (repositoryRoot) => {
  try {
    const result = await executeFile(
      "git",
      ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
        maxBuffer: 256,
        timeout: 5_000,
        windowsHide: true,
      },
    );
    if (result.stderr !== "" || !fullObjectName.test(result.stdout)) {
      return { status: "unavailable", reason: "git_head_unavailable" };
    }
    return { status: "observed", content: `${result.stdout.trim()}\n` };
  } catch {
    return { status: "unavailable", reason: "git_head_unavailable" };
  }
};
