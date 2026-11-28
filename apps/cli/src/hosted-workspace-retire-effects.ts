// The real effects of retiring a hosted workspace: the launch records, the repository registry,
// Git, the process table, and the session settings files.
import { execFile } from "node:child_process";
import { readdir, readlink, realpath, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
} from "@lervo/repository-registry";

import { CommandFailure } from "./command-error-output.js";
import { conversationRetirementEffects } from "./conversation-retirement-effects.js";
import {
  hostedLaunchRecordsPath,
  hostedSessionsOfWorkspace,
  latestHostedLaunch,
  memberWorkspacesOf,
} from "./hosted-launch-records.js";
import { hostedSessionSettingsDirectory } from "./hosted-session-settings.js";
import type { WorkspaceRetireEffects } from "./hosted-workspace-retire.js";
import { branchMergedIntoDefault } from "./hosted-branch-merged.js";
import { keepRetiredChanges } from "./retired-workspace-changes.js";
import { worktreeOfBranch } from "./workspace-start-effects.js";

const execute = promisify(execFile);
/** Enough for the working directories of every process on a busy host. */
const MAX_LSOF_OUTPUT_BYTES = 16 * 1024 * 1024;

async function git(root: string, arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_], { encoding: "utf8" });
  return stdout.trim();
}

async function succeeds(run: Promise<unknown>): Promise<boolean> {
  return run.then(
    () => true,
    () => false,
  );
}

/**
 * The working directory of every other process. Linux and WSL read `/proc`; macOS asks `lsof`,
 * which every macOS installs. A host that offers neither cannot tell, so retiring refuses.
 */
async function processDirectories(): Promise<string[]> {
  if (process.platform === "linux") {
    const pids = (await readdir("/proc")).filter((name) => /^\d+$/u.test(name));
    const directories = await Promise.all(
      pids
        .filter((pid) => Number(pid) !== process.pid)
        .map((pid) => readlink(`/proc/${pid}/cwd`).catch(() => null)),
    );
    return directories.filter((directory): directory is string => directory !== null);
  }
  try {
    const { stdout } = await execute("lsof", ["-a", "-d", "cwd", "-F", "pn"], {
      encoding: "utf8",
      maxBuffer: MAX_LSOF_OUTPUT_BYTES,
    });
    const directories: string[] = [];
    let own = false;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) own = Number(line.slice(1)) === process.pid;
      else if (line.startsWith("n") && !own) directories.push(line.slice(1));
    }
    return directories;
  } catch (error) {
    // lsof exits 1 when it lists nothing, and its output still holds whatever it found.
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.length > 0)
      return stdout
        .split("\n")
        .filter((line) => line.startsWith("n"))
        .map((line) => line.slice(1));
    throw new CommandFailure(
      "workspace_use_unverifiable",
      "Lervo could not list the working directories of this host's processes, so it does not retire the workspace.",
    );
  }
}

export function hostedWorkspaceRetireEffects(): WorkspaceRetireEffects {
  const records = hostedLaunchRecordsPath();
  return {
    latestLaunch: (workspaceId) => latestHostedLaunch(records, workspaceId),
    membersOf: (workspaceId) => memberWorkspacesOf(records, workspaceId),
    sessionsOf: (workspaceId) => hostedSessionsOfWorkspace(records, workspaceId),
    async repositoryRoot(projectId) {
      const registrations = await listRegisteredRepositories(defaultRepositoryRegistryPath());
      return registrations.find((entry) => entry.projectId === projectId)?.repositoryRoot ?? null;
    },
    worktreeOf: worktreeOfBranch,
    async inUse(worktree) {
      const target = await realpath(worktree).catch(() => resolve(worktree));
      return (await processDirectories()).some(
        (directory) => directory === target || directory.startsWith(`${target}${sep}`),
      );
    },
    async hasChanges(worktree) {
      return (await git(worktree, ["status", "--porcelain", "--untracked-files=normal"])) !== "";
    },
    keepChanges: (root, worktree, workspaceId) => keepRetiredChanges(root, worktree, workspaceId),
    async removeWorktree(root, worktree, force) {
      // Without --force, Git itself refuses a worktree that changed after the check above; with
      // it, only after the changes were kept.
      await git(root, ["worktree", "remove", ...(force ? ["--force"] : []), worktree]).catch(() => {
        throw new CommandFailure(
          "workspace_has_changes",
          "Git refused to remove the workspace, which changed or is locked. Check it and retry.",
        );
      });
    },
    branchExists: (root, branch) =>
      succeeds(git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])),
    branchMerged: (root, branch) => branchMergedIntoDefault(root, branch).catch(() => false),
    async deleteBranch(root, branch) {
      await git(root, ["branch", "-D", branch]);
    },
    conversation: conversationRetirementEffects(),
    async removeSessionSettings(sessionIds) {
      const directory = hostedSessionSettingsDirectory();
      await Promise.all(
        sessionIds.map((sessionId) => rm(resolve(directory, `${sessionId}.json`), { force: true })),
      );
    },
  };
}
