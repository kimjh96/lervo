// `workspace.retire` and `lervo workspace retire`: removes a hosted workspace its user is done
// with (Lervo ADE sessions, "Retiring a workspace"). Retiring never discards work: it refuses a
// worktree that a process still uses or that holds changes, and it deletes the branch only when
// Lervo created it and the default branch or its upstream already holds its changes.
import type { WorkspaceRetireResult } from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";
import type { ConversationRetirementEffects } from "./conversation-retirement-effects.js";
import type { HostedLaunchRecord } from "./hosted-launch-records.js";

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
  removeWorktree(root: string, worktree: string): Promise<void>;
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
  const worktree = await effects.worktreeOf(root, launch.branch);
  if (worktree !== null) {
    if (await effects.inUse(worktree))
      throw new CommandFailure(
        "workspace_in_use",
        "A process still runs in the workspace. Stop its session, leave the directory, and retry.",
        { workspaceId },
      );
    if (await effects.hasChanges(worktree))
      throw new CommandFailure(
        "workspace_has_changes",
        "The workspace holds uncommitted changes or new files. Commit or remove them, then retry.",
        { workspaceId },
      );
    await effects.removeWorktree(root, worktree);
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
  return { workspaceId, worktree: worktree === null ? "absent" : "removed", branch };
}
