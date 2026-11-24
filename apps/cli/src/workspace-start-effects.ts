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
import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "@lervo/repository-knowledge-runtime";
import type { WorkspaceOwnershipMarker } from "@lervo/workspace-host";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";

import { CommandFailure } from "./command-error-output.js";
import { bindCheckedOutBranch, resolveDefaultBranch } from "./workstream-branch-selection.js";
import { workstreamSnapshotRecorder } from "./workstream-recording.js";
import { observeRepositoryHead } from "./workstream-repository-head.js";
import { runGit } from "./workspace-base-git.js";
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

/** Replay never runs the owner's hooks or signing, whatever the repository configures. */
const REPLAY_CONFIG = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false"];
/** Each pick commits as `Lervo Knowledge` and ends within the ADE's command deadline. */
const REPLAY_OPTIONS = {
  timeout: 20_000,
  env: {
    GIT_COMMITTER_NAME: KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.name,
    GIT_COMMITTER_EMAIL: KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email,
  },
};

/** Whether a stopped pick stopped only because its change is already on the branch. */
async function emptyPick(at: string): Promise<boolean> {
  const conflicted = await runGit(at, ["ls-files", "--unmerged"]).catch(() => "conflicted");
  if (conflicted !== "") return false;
  return runGit(at, ["diff", "--cached", "--quiet"]).then(
    () =>
      runGit(at, ["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).then(
        () => true,
        () => false,
      ),
    () => false,
  );
}

/**
 * Undoes a pick that did not apply. When Git cannot abort, as with a stale `index.lock`, the pick
 * is dropped and the branch returns to its last good commit; when that fails too, the start fails
 * and its rollback removes the branch.
 */
async function abandonPick(at: string, lastGood: string): Promise<void> {
  try {
    await runGit(at, ["cherry-pick", "--abort"]);
  } catch {
    await runGit(at, ["cherry-pick", "--quit"]).catch(() => undefined);
    await runGit(at, ["reset", "--hard", "--quiet", lastGood]);
  }
}

/** The Git effects of the workspace stage and their reversal. */
export function gitWorkspaceEffects() {
  const host = new GitWorkspaceHostAdapter();
  let owned: ReturnType<typeof ownership> | null = null;
  // The branch's tip after each replayed commit, so a rollback removes the branch it made.
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
     * Replays the unpublished knowledge commits on the new branch, committed by `Lervo Knowledge`
     * like the originals, so the resident still recognizes them. The owner's hooks and signing
     * never run, and each pick has a deadline. A commit whose change the branch already holds is
     * carried, one that does not apply cleanly is skipped, and the workspace still starts. When a
     * failed pick cannot be undone, the branch returns to its last good commit, or the start fails
     * and rolls back.
     */
    async replayEffects(placement: WorkspacePlacement): Promise<EffectReplay> {
      const replayed: string[] = [];
      const skipped: string[] = [];
      const carried: string[] = [];
      const at = placement.workspacePath;
      tip = await runGit(at, ["rev-parse", "HEAD"]);
      for (const commit of placement.replay ?? []) {
        try {
          await runGit(at, [...REPLAY_CONFIG, "cherry-pick", commit], REPLAY_OPTIONS);
          replayed.push(commit);
        } catch {
          if (await emptyPick(at)) {
            await runGit(at, [...REPLAY_CONFIG, "cherry-pick", "--skip"], REPLAY_OPTIONS);
            carried.push(commit);
          } else {
            await abandonPick(at, tip);
            skipped.push(commit);
          }
        }
        tip = await runGit(at, ["rev-parse", "HEAD"]);
      }
      return { replayed, skipped, carried };
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
