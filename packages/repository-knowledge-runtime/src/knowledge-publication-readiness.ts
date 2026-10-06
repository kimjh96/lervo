import { execFile } from "node:child_process";

import {
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
 * The branch the remote itself reports as its default, from `ls-remote --symref`. The local
 * `refs/remotes/origin/HEAD` is not consulted: it is set once at clone time, may be missing, and
 * may name a feature branch someone checked out with `remote set-head`.
 */
function remoteDefaultBranch(lsRemoteSymref: string): string | null {
  for (const line of lsRemoteSymref.split("\n")) {
    const match = /^ref: refs\/heads\/(\S+)\tHEAD$/u.exec(line.trim());
    if (match !== null) return match[1]!;
  }
  return null;
}

/**
 * ADR-0469 and ADR-0473: publication settings this host can serve without operator input, or
 * null. It requires an `origin` remote, the remote's own default branch, and an authenticated `gh`
 * session. Nothing is pushed or stored; the probe reads the remote's advertised `HEAD` and the
 * `gh` login. The derived scope is the knowledge write scope, never fixed roots.
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
  const advertised = await execute(git, ["ls-remote", "--symref", "origin", "HEAD"]);
  const baseBranch = advertised === null ? null : remoteDefaultBranch(advertised);
  if (baseBranch === null || baseBranch === DEFAULT_KNOWLEDGE_PUBLICATION_BRANCH) return null;
  if ((await execute(input.ghExecutable ?? "gh", ["auth", "status"])) === null) return null;
  return parseKnowledgePublicationSettings({
    remote: "origin",
    baseBranch,
    branch: DEFAULT_KNOWLEDGE_PUBLICATION_BRANCH,
    merge: "when_checks_pass",
    scope: "delegation",
  });
}
