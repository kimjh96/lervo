// The real effects of `lervo workspace start` and `open`: Git and the workstream service.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  openProjectStorage,
  repositoryCoordinateDigest,
  resolveRepositoryCoordinationHome,
} from "@lervo/project-storage";
import { applyWorkstreamStartPlan, createWorkstreamStartPlan } from "@lervo/repository-knowledge";
import type { WorkspaceOwnershipMarker } from "@lervo/workspace-host";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";

import { CommandFailure } from "./command-error-output.js";
import { bindCheckedOutBranch, resolveDefaultBranch } from "./workstream-branch-selection.js";
import { workstreamSnapshotRecorder } from "./workstream-recording.js";
import { observeRepositoryHead } from "./workstream-repository-head.js";
import { LERVO_EFFECT_AUTHOR as LERVO_EFFECT_COMMITTER } from "./workspace-base.js";
import type { EffectReplay, WorkspacePlacement } from "./workspace-start.js";

const execute = promisify(execFile);

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function git(root: string, arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_], { encoding: "utf8" });
  return stdout.trim();
}

/** The tip of the repository's default branch, where new work starts. */
export async function defaultBranchCommit(root: string): Promise<string> {
  const branch = await resolveDefaultBranch(root, "HEAD");
  return git(root, ["rev-parse", "--verify", `${branch}^{commit}`]);
}

function ownership(placement: WorkspacePlacement, repositoryInstanceId: string) {
  const marker: WorkspaceOwnershipMarker = {
    schemaVersion: 1,
    workspaceId: placement.workspaceId,
    generation: 1,
    repositoryInstanceId,
    adapterKind: "git",
    adapterVersion: "1.0.0",
    creationPlanId: `wpl_${hex(12)}`,
    pathDigest: repositoryCoordinateDigest(placement.workspacePath),
  };
  return {
    repositoryRoot: placement.repositoryRoot,
    workspacePath: placement.workspacePath,
    baseCommit: placement.baseCommit,
    marker,
  };
}

/** The Git effects of the workspace stage and their reversal. */
export function gitWorkspaceEffects() {
  const host = new GitWorkspaceHostAdapter();
  let owned: ReturnType<typeof ownership> | null = null;
  // The branch's tip after replayed effect commits, so a rollback removes the branch it made.
  let tip: string | null = null;
  return {
    async provisionWorkspace(placement: WorkspacePlacement): Promise<void> {
      const home = await resolveRepositoryCoordinationHome(placement.repositoryRoot);
      owned = ownership(placement, home.repositoryInstanceId);
      await mkdir(dirname(placement.workspacePath), { recursive: true });
      await host.provisionBranch({
        ...owned,
        branch: placement.branch,
        idempotencyKey: `idk_${hex(12)}`,
      });
    },
    /**
     * Replays unpublished Lervo effect commits on the new branch, committed as Lervo like the
     * originals. A commit that does not apply cleanly is skipped, so the workspace still starts.
     */
    async replayEffects(placement: WorkspacePlacement): Promise<EffectReplay> {
      const replayed: string[] = [];
      const skipped: string[] = [];
      const asLervo = ["-c", "user.name=Lervo", "-c", `user.email=${LERVO_EFFECT_COMMITTER}`];
      for (const commit of placement.replay ?? []) {
        try {
          await git(placement.workspacePath, [...asLervo, "cherry-pick", "--allow-empty", commit]);
          replayed.push(commit);
        } catch {
          await git(placement.workspacePath, ["cherry-pick", "--abort"]).catch(() => undefined);
          skipped.push(commit);
        }
      }
      tip = await git(placement.workspacePath, ["rev-parse", "HEAD"]);
      return { replayed, skipped };
    },
    async removeWorkspace(placement: WorkspacePlacement): Promise<void> {
      // Right after creation the checkout holds only Lervo's own state, so discarding is safe.
      if (owned !== null)
        await host.removeDiscardingChanges({ ...owned, idempotencyKey: `idk_${hex(12)}` });
      await host.removeBranch({
        repositoryRoot: placement.repositoryRoot,
        branch: placement.branch,
        expectedCommit: tip ?? placement.baseCommit,
      });
    },
  };
}

/** Starts the workstream in the new worktree, as `lervo workstream start --apply-now` would. */
export async function startWorkstreamIn(input: {
  root: string;
  title: string;
  objective: string;
}): Promise<string> {
  const storage = await openProjectStorage(input.root);
  try {
    const now = new Date();
    const plan = await createWorkstreamStartPlan({
      repositoryRoot: input.root,
      projectId: storage.manifest.projectId,
      draft: {
        schemaVersion: 1,
        title: input.title,
        objective: input.objective,
        status: "active",
        blockers: [],
        nextActions: [],
        notes: [],
        references: [],
        pendingApprovals: [],
        pendingDecisions: [],
      },
      bookkeeping: {
        recordedAt: now.toISOString(),
        repositoryHead: await observeRepositoryHead(input.root, now),
      },
    });
    if (plan.status !== "ready")
      throw new CommandFailure("workstream_start_blocked", "The workstream could not start.", {
        blockers: plan.blockers.map((blocker) => blocker.code),
      });
    const actor = { kind: "user" as const, provider: null };
    const receipt = await applyWorkstreamStartPlan({
      plan,
      now,
      actor: actor.kind,
      recordApplied: workstreamSnapshotRecorder({ storage, actor, operation: "start" }),
    });
    await bindCheckedOutBranch(input.root, receipt.workstreamId);
    return receipt.workstreamId;
  } finally {
    await storage.close();
  }
}

/** Each checked-out branch's worktree, from one `git worktree list`. */
export async function worktreesByBranch(root: string): Promise<Map<string, string>> {
  const worktrees = new Map<string, string>();
  try {
    const listing = await git(root, ["worktree", "list", "--porcelain"]);
    let path: string | null = null;
    for (const line of listing.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      const branch = line.startsWith("branch refs/heads/")
        ? line.slice("branch refs/heads/".length)
        : null;
      if (branch !== null && path !== null) worktrees.set(branch, resolve(path));
    }
  } catch {
    // A repository Git cannot read lists no worktrees.
  }
  return worktrees;
}

/** The worktree that has `branch` checked out, or null. */
export async function worktreeOfBranch(root: string, branch: string): Promise<string | null> {
  return (await worktreesByBranch(root)).get(branch) ?? null;
}
