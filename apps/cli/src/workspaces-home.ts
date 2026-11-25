// Where hosted workspaces live (Lervo ADE sessions, "The workspace stage"): one place apart from
// the owner's projects, so starting work never adds a folder beside or inside a repository.
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import { runGit } from "./workspace-base-git.js";

/** The refusal of a workspaces home that would put workspaces where they do not belong. */
export function invalidWorkspacesHome(message: string): CommandFailure {
  return new CommandFailure("workspace_home_invalid", message);
}

/**
 * `~/.lervo/workspaces`, beside Lervo's other per-user state, on every host alike.
 * `LERVO_WORKSPACES_HOME` moves it, as tests do; when set, it must be a safe absolute path, like
 * `LERVO_USER_STATE_DIRECTORY`, or the start is refused before anything changes.
 */
export function workspacesHome(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment.LERVO_WORKSPACES_HOME;
  if (override === undefined) return resolve(homedir(), ".lervo", "workspaces");
  if (override === "" || !isAbsolute(override) || /[\0\r\n]/u.test(override))
    throw invalidWorkspacesHome("LERVO_WORKSPACES_HOME must be a safe absolute path.");
  return resolve(override);
}

/**
 * Whether `path`, or the nearest folder above it that exists, lies inside a Git repository: in a
 * work tree, in a `.git` folder, or in a bare repository. Workspaces there would fill that
 * repository with untracked folders and nested worktrees. The caller's `GIT_DIR` and
 * `GIT_WORK_TREE` are ignored, so only the folder decides. When Git cannot answer, the start goes
 * on: a missing Git fails the workspace stage anyway.
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
  return runGit(existing, ["rev-parse", "--is-inside-work-tree", "--is-inside-git-dir"], {
    unset: ["GIT_DIR", "GIT_WORK_TREE"],
  }).then(
    (answer) => answer.split("\n").some((line) => line.trim() === "true"),
    () => false,
  );
}
