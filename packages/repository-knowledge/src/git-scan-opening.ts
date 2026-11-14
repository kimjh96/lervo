import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  observeGitIgnoredPaths,
  type GitIgnoredPaths,
  type ObserveGitIgnoredPaths,
} from "./git-ignored-paths.js";
import { ignoredPathsBelowPrefix } from "./git-ignored-status.js";
import {
  observeGitHeadRevision,
  type GitRevisionObservation,
  type ObserveGitRevision,
} from "./git-revision-source.js";

const executeFile = promisify(execFile);
/** `--show-prefix` output, then the verified commit: the last line is always the object name. */
const prefixThenObjectName = /^([\s\S]*)\n([0-9a-f]{40}|[0-9a-f]{64})\n$/u;

export interface GitScanOpening {
  revisionBefore: GitRevisionObservation;
  /** Called after the opening revision, exactly where the scan observed ignored paths before. */
  observeIgnoredPaths(): Promise<GitIgnoredPaths>;
}

/**
 * The opening revision and the work-tree prefix the ignore observation needs come from one
 * `git rev-parse` process, which prints each exactly as its separate invocation would. Any other
 * answer, such as an unborn HEAD, falls back to the separate observations unchanged.
 */
async function observeRevisionAndPrefix(
  repositoryRoot: string,
): Promise<{ revision: GitRevisionObservation; prefix: string } | null> {
  try {
    const result = await executeFile(
      "git",
      ["rev-parse", "--show-prefix", "--verify", "--end-of-options", "HEAD^{commit}"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        maxBuffer: 64 * 1024,
        timeout: 5_000,
        windowsHide: true,
      },
    );
    const match = prefixThenObjectName.exec(result.stdout);
    if (result.stderr !== "" || match === null) return null;
    return {
      revision: { status: "observed", content: `${match[2]!}\n` },
      prefix: match[1]!.trim(),
    };
  } catch {
    return null;
  }
}

/** Default observers share one opening process; an injected observer keeps its own call. */
export async function observeGitScanOpening(
  repositoryRoot: string,
  observers: { observeRevision?: ObserveGitRevision; observeIgnoredPaths?: ObserveGitIgnoredPaths },
): Promise<GitScanOpening> {
  if (observers.observeRevision === undefined && observers.observeIgnoredPaths === undefined) {
    const combined = await observeRevisionAndPrefix(repositoryRoot);
    if (combined !== null)
      return {
        revisionBefore: combined.revision,
        observeIgnoredPaths: () => ignoredPathsBelowPrefix(repositoryRoot, combined.prefix),
      };
  }
  const revisionBefore = await (observers.observeRevision ?? observeGitHeadRevision)(
    repositoryRoot,
  );
  return {
    revisionBefore,
    observeIgnoredPaths: () =>
      (observers.observeIgnoredPaths ?? observeGitIgnoredPaths)(repositoryRoot),
  };
}
