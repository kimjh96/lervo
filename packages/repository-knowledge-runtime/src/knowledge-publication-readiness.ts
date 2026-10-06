import { execFile } from "node:child_process";

import {
  DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS,
  parseKnowledgePublicationSettings,
  type KnowledgePublicationSettings,
} from "./knowledge-publication-settings.js";

/** The rolling publication branch ADR-0466 names as its default. */
export const DEFAULT_KNOWLEDGE_PUBLICATION_BRANCH = "lervo/knowledge-outputs";

type Run = (executable: string, args: string[]) => Promise<string | null>;

function run(root: string): Run {
  return (executable, args) =>
    new Promise((resolveRun) => {
      execFile(
        executable,
        args,
        {
          cwd: root,
          timeout: 15_000,
          maxBuffer: 64 * 1024,
          env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
        },
        (error, stdout) => resolveRun(error === null ? stdout : null),
      );
    });
}

/**
 * ADR-0469: publication settings this host can serve without operator input, or null. It
 * requires an `origin` remote, an observable remote default branch, and an authenticated `gh`
 * session. Nothing is fetched, pushed, or stored; the probe only reads local Git state and the
 * `gh` login.
 */
export async function probeKnowledgePublicationSettings(input: {
  repositoryRoot: string;
  gitExecutable?: string;
  ghExecutable?: string;
  runner?: Run;
}): Promise<KnowledgePublicationSettings | null> {
  const execute = input.runner ?? run(input.repositoryRoot);
  const git = input.gitExecutable ?? "git";
  if ((await execute(git, ["remote", "get-url", "origin"])) === null) return null;
  const head = (
    await execute(git, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
  )?.trim();
  const baseBranch = head?.startsWith("origin/") ? head.slice("origin/".length) : null;
  if (baseBranch === null || baseBranch === DEFAULT_KNOWLEDGE_PUBLICATION_BRANCH) return null;
  if ((await execute(input.ghExecutable ?? "gh", ["auth", "status"])) === null) return null;
  return parseKnowledgePublicationSettings({
    remote: "origin",
    baseBranch,
    branch: DEFAULT_KNOWLEDGE_PUBLICATION_BRANCH,
    merge: "when_checks_pass",
    allowedRoots: [...DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS],
  });
}
