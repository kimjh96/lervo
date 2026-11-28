// `workspace.retire` and `lervo workspace retire`: removes a hosted workspace its user is done
// with (Lervo ADE sessions, "Retiring a workspace"). Retiring never loses work: it refuses a
// worktree that a process still uses, and one that holds changes unless its owner removes it with
// them, when it first keeps a bounded copy of them. It deletes the branch only when Lervo created
// it and the default branch or its upstream already holds its changes.
import type { WorkspaceRetireResult } from "@lervo/session-host-contract";

import { type KeptChanges, NestedRepositoryChanges } from "./retired-workspace-changes.js";

import { CommandFailure } from "./command-error-output.js";
import type { ConversationRetirementEffects } from "./conversation-retirement-effects.js";
import type { HostedLaunchRecord } from "./hosted-launch-records.js";

/**
 * How long retiring waits for processes to leave a worktree before it refuses. A session the ADE
 * just stopped reports its end while its hooks and child processes are still finishing, so the
 * first check would refuse work that is about to leave.
 */
const LEAVE_WAIT_MS = 5000;
const LEAVE_POLL_MS = 250;

/** Whether no process works in the worktree, waiting up to `waitMs` for the last ones to leave. */
async function leftOrIdle(
  effects: WorkspaceRetireEffects,
  worktree: string,
  waitMs: number,
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (await effects.inUse(worktree)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(LEAVE_POLL_MS, waitMs)));
  }
  return true;
}

/** Branches Lervo creates for hosted workspaces; retiring never deletes any other branch. */
const HOSTED_BRANCH = /^lervo\/[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{6}$/u;

/** What retiring reads and changes, so tests can run it without Git or a process table. */
export interface WorkspaceRetireEffects {
  latestLaunch(workspaceId: string): Promise<HostedLaunchRecord | null>;
  sessionsOf(workspaceId: string): Promise<string[]>;
  repositoryRoot(projectId: string): Promise<string | null>;
  worktreeOf(root: string, branch: string): Promise<string | null>;
  /** Whether any process other than this one has its working directory in the worktree. */
  inUse(worktree: string): Promise<boolean>;
  /** Whether the worktree holds changes to tracked files or untracked files Git does not ignore. */
  hasChanges(worktree: string): Promise<boolean>;
  /** Keeps a copy of the worktree's changes under the workspace's ref. */
  keepChanges(root: string, worktree: string, workspaceId: string): Promise<KeptChanges>;
  /** Removes the worktree; `force` only after its changes were kept. */
  removeWorktree(root: string, worktree: string, force: boolean): Promise<void>;
  branchExists(root: string, branch: string): Promise<boolean>;
  /**
   * Whether the default branch, or its upstream, already holds every change of `branch`: the tip
   * is in one of them, or every commit beyond the upstream copies a patch one of them holds.
   */
  branchMerged(root: string, branch: string): Promise<boolean>;
  deleteBranch(root: string, branch: string): Promise<void>;
  removeSessionSettings(sessionIds: readonly string[]): Promise<void>;
  /** The conversation's coordination: its lease, generation records, and changed paths. */
  conversation: ConversationRetirementEffects;
}

export async function retireHostedWorkspace(
  workspaceId: string,
  effects: WorkspaceRetireEffects,
  options: {
    /** Whether the owner chose to remove the workspace with its changes, keeping a copy of them. */
    discardChanges?: boolean;
    /** How long to wait for processes to leave the worktree; tests shorten it. */
    leaveWaitMs?: number;
  } = {},
): Promise<WorkspaceRetireResult> {
  const launch = await effects.latestLaunch(workspaceId);
  const root = launch === null ? null : await effects.repositoryRoot(launch.projectId);
  if (launch === null || root === null)
    throw new CommandFailure(
      "workspace_not_found",
      "No hosted workspace with that ID was prepared in a registered repository on this host.",
      { workspaceId },
    );
  await effects.conversation.assertRetirable(root, workspaceId);
  // A conversation's worktree is found by its record's path when its branch moved.
  const worktree =
    (await effects.worktreeOf(root, launch.branch)) ??
    (await effects.conversation.worktreeOf(root, workspaceId));
  let keptChanges: KeptChanges | undefined;
  if (worktree !== null) {
    if (!(await leftOrIdle(effects, worktree, options.leaveWaitMs ?? LEAVE_WAIT_MS)))
      throw new CommandFailure(
        "workspace_in_use",
        "A process still runs in the workspace. Stop its session, leave the directory, and retry.",
        { workspaceId },
      );
    if (await effects.hasChanges(worktree)) {
      if (options.discardChanges !== true)
        throw new CommandFailure(
          "workspace_has_changes",
          "The workspace holds uncommitted changes or new files. Commit or remove them, or remove the workspace with them, then retry.",
          { workspaceId },
        );
      // Nothing is removed unless the copy exists.
      keptChanges = await effects.keepChanges(root, worktree, workspaceId).catch((error) => {
        if (error instanceof NestedRepositoryChanges)
          throw new CommandFailure(
            "workspace_nested_repository",
            "A nested repository or submodule in the workspace holds work a copy cannot keep. Commit and push it, or remove it, then retry.",
            { workspaceId, paths: error.paths.slice(0, 10) },
          );
        throw new CommandFailure(
          "workspace_changes_not_kept",
          "Lervo could not keep a copy of the workspace's changes, so it removed nothing.",
          { workspaceId },
        );
      });
      // A process that started meanwhile could still be writing what the copy missed.
      if (await effects.inUse(worktree))
        throw new CommandFailure(
          "workspace_in_use",
          "A process still runs in the workspace. Stop its session, leave the directory, and retry.",
          { workspaceId },
        );
    }
    await effects.removeWorktree(root, worktree, keptChanges !== undefined);
  }
  await effects.conversation.retire(root, workspaceId);
  let branch: WorkspaceRetireResult["branch"] = "absent";
  if (await effects.branchExists(root, launch.branch)) {
    const removable =
      HOSTED_BRANCH.test(launch.branch) && (await effects.branchMerged(root, launch.branch));
    if (removable) await effects.deleteBranch(root, launch.branch);
    branch = removable ? "deleted" : "kept";
  }
  await effects.removeSessionSettings(await effects.sessionsOf(workspaceId));
  return {
    workspaceId,
    worktree: worktree === null ? "absent" : "removed",
    branch,
    ...(keptChanges === undefined
      ? {}
      : { keptChanges: { ref: keptChanges.ref, restore: keptChanges.restore } }),
  };
}
