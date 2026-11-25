// Where hosted workspaces live (Lervo ADE sessions, "The workspace stage"): one place apart from
// the owner's projects, so starting work never adds a folder beside or inside a repository.
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

import { runGit } from "./workspace-base-git.js";

/**
 * `~/.lervo/workspaces`, beside Lervo's other per-user state, on every host alike;
 * `LERVO_WORKSPACES_HOME` moves it, as tests do.
 */
export function workspacesHome(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment.LERVO_WORKSPACES_HOME;
  if (override !== undefined && isAbsolute(override) && !/[\0\r\n]/u.test(override))
    return resolve(override);
  return resolve(homedir(), ".lervo", "workspaces");
}

/**
 * Whether `path`, or the nearest folder above it that exists, lies inside a Git work tree. A
 * workspaces home there would fill that repository with untracked folders and nested worktrees.
 */
export async function insideRepository(path: string): Promise<boolean> {
  let existing = resolve(path);
  for (;;) {
    if (
      await access(existing).then(
        () => true,
        () => false,
      )
    )
      break;
    const parent = dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  return runGit(existing, ["rev-parse", "--is-inside-work-tree"]).then(
    (answer) => answer === "true",
    () => false,
  );
}
