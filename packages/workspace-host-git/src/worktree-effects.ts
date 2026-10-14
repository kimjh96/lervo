import { lstat } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  WorkspaceHostInspection,
  WorkspaceProvisionRequest,
  WorkspaceRemovalRequest,
} from "@lervo/workspace-host";

import type { GitWorkspaceEvidence } from "./evidence.js";
import { fail, git } from "./git-command.js";

const COMMIT = /^[a-f0-9]{40,64}$/u;

/** The native Git worktree effects; each rechecks ownership through the shared evidence first. */
export class GitWorktreeEffects {
  constructor(private readonly evidence: GitWorkspaceEvidence) {}

  async provisionDetached(
    request: WorkspaceProvisionRequest,
    beforeMutation?: () => Promise<void>,
  ): Promise<WorkspaceHostInspection> {
    this.evidence.validateRequest(request.repositoryRoot, request.workspacePath, request.marker);
    if (
      !COMMIT.test(request.baseCommit) ||
      !/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey)
    )
      fail("host_coordinate_invalid", "The Git provision binding is invalid.");
    const existing = await this.evidence.inspect(request);
    if (existing.status !== "absent") {
      if (existing.markerMatched && existing.headCommit === request.baseCommit) return existing;
      fail("host_effect_uncertain", "A different workspace occupies the provision coordinate.");
    }
    const parentInfo = await lstat(dirname(request.workspacePath));
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
      fail("host_coordinate_invalid", "The workspace parent must be a real directory.");
    await beforeMutation?.();
    await git(request.repositoryRoot, [
      "worktree",
      "add",
      "--detach",
      request.workspacePath,
      request.baseCommit,
    ]);
    try {
      await this.evidence.writeMarker(request.workspacePath, request.marker);
    } catch (error) {
      fail("host_effect_uncertain", "The worktree exists without its ownership marker.", error);
    }
    return this.evidence.inspect(request);
  }

  async removeNonForce(request: WorkspaceRemovalRequest): Promise<WorkspaceHostInspection> {
    return this.removeWorktree(request, false);
  }

  /**
   * Removes an owned worktree together with its uncommitted bytes. Only a caller that proved every
   * byte in the checkout is Lervo-generated and disposable may use it; the marker and in-progress
   * Git operation checks still apply.
   */
  async removeDiscardingChanges(
    request: WorkspaceRemovalRequest,
  ): Promise<WorkspaceHostInspection> {
    return this.removeWorktree(request, true);
  }

  private async removeWorktree(
    request: WorkspaceRemovalRequest,
    discardChanges: boolean,
  ): Promise<WorkspaceHostInspection> {
    this.evidence.validateRequest(request.repositoryRoot, request.workspacePath, request.marker);
    if (!/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey))
      fail("host_coordinate_invalid", "The Git removal binding is invalid.");
    const before = await this.evidence.inspect(request);
    if (before.status === "absent") return before;
    if (!before.markerMatched)
      fail("host_marker_mismatch", "The workspace ownership marker changed.");
    if (before.gitOperationInProgress)
      fail("host_operation_in_progress", "A Git operation is in progress.");
    if (!before.clean && !discardChanges)
      fail("host_not_clean", "The workspace contains tracked or untracked changes.");
    await git(request.repositoryRoot, [
      "worktree",
      "remove",
      ...(discardChanges ? ["--force"] : []),
      request.workspacePath,
    ]);
    const after = await this.evidence.inspect(request);
    if (after.status !== "absent")
      fail("host_effect_uncertain", "Git did not prove worktree removal.");
    return after;
  }
}
