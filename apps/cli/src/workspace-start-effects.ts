// The real effects of `lervo workspace start` and `open`: Git and the workstream service.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { conversationWorkspaceRecordId } from "@lervo/agent-workforce";
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
import { bindCheckedOutBranch } from "./workstream-branch-selection.js";
import { workstreamSnapshotRecorder } from "./workstream-recording.js";
import { observeRepositoryHead } from "./workstream-repository-head.js";
import { defaultBranchOf } from "./workspace-base.js";
import { runGit } from "./workspace-base-git.js";
import type { EffectReplay, WorkspacePlacement } from "./workspace-start.js";
import { resolveCommandRoots } from "./terminal-roots.js";

const execute = promisify(execFile);

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function git(root: string, arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_], { encoding: "utf8" });
  return stdout.trim();
}

/**
 * The tip of the repository's default branch, resolved as the workspace's base resolves it, or the
 * checked-out commit when the repository names none.
 */
export async function defaultBranchCommit(root: string): Promise<string> {
  const resolved = await defaultBranchOf(root).catch(() => null);
  return git(root, ["rev-parse", "--verify", `${resolved?.ref ?? "HEAD"}^{commit}`]);
}

/**
 * The ownership marker of the conversation's first generation. It names the generation's own
 * workspace record, derived from the conversation's workspace ID, so every reader that rebuilds a
 * marker from a record finds it; a later generation replaces it by compare-and-swap. The adapter
 * names itself, and the path digest is of the worktree's real path, as the record's is.
 */
function ownership(
  placement: WorkspacePlacement,
  repositoryInstanceId: string,
  host: { kind: "git"; version: string },
  realWorkspacePath: string,
) {
  const marker: WorkspaceOwnershipMarker = {
    schemaVersion: 1,
    workspaceId: conversationWorkspaceRecordId(placement.workspaceId, 1),
    generation: 1,
    repositoryInstanceId,
    adapterKind: host.kind,
    adapterVersion: host.version,
    creationPlanId: `wpl_${hex(12)}`,
    pathDigest: repositoryCoordinateDigest(realWorkspacePath),
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
/**
 * The whole replay's budget, which bounds each pick's deadline too. With the 20-second fetch, it
 * keeps a start within the ADE's 120-second command deadline; past it, the replay is dropped and
 * the workspace still starts.
 */
const REPLAY_BUDGET_MS = 45_000;
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
 * Picks one commit within the replay's budget: `replayed` when it applied, `carried` when the
 * branch already held its change. Throws when it conflicts, times out, or comes past the budget.
 */
async function pick(at: string, commit: string, started: number): Promise<"replayed" | "carried"> {
  const left = REPLAY_BUDGET_MS - (Date.now() - started);
  if (left <= 0) throw new Error("The replay passed its budget.");
  const options = { ...REPLAY_OPTIONS, timeout: Math.min(REPLAY_OPTIONS.timeout, left) };
  try {
    await runGit(at, [...REPLAY_CONFIG, "cherry-pick", commit], options);
    return "replayed";
  } catch (error) {
    if (!(await emptyPick(at))) throw error;
    await runGit(at, [...REPLAY_CONFIG, "cherry-pick", "--skip"], options);
    return "carried";
  }
}

/**
 * Drops a stopped pick and every pick before it: the branch returns to its base. When Git cannot
 * abort, the pick is quit before the reset; a reset that fails throws, so the start fails and its
 * rollback removes the branch.
 */
async function returnToBase(at: string, base: string): Promise<void> {
  const quick = { timeout: 10_000 };
  await runGit(at, ["cherry-pick", "--abort"], quick).catch(() =>
    runGit(at, ["cherry-pick", "--quit"], quick).catch(() => undefined),
  );
  // A pick stopped at its deadline can leave the index lock. The worktree is the one this start
  // created moments ago and nothing else works in it, so a lock there is the stopped pick's own.
  const lock = await runGit(at, ["rev-parse", "--git-path", "index.lock"], quick).catch(() => "");
  if (lock !== "") await rm(resolve(at, lock), { force: true });
  await runGit(at, ["reset", "--hard", "--quiet", base], quick);
}

/** The Git effects of the workspace stage and their reversal. */
export function gitWorkspaceEffects() {
  const host = new GitWorkspaceHostAdapter();
  let owned: ReturnType<typeof ownership> | null = null;
  // The branch's tip after each replayed commit, so a rollback removes the branch it made.
  let tip: string | null = null;
  return {
    /** The marker the workspace stage wrote, for the coordination stage to bind; null before. */
    provisionedMarker(): WorkspaceOwnershipMarker | null {
      return owned?.marker ?? null;
    },
    async provisionWorkspace(placement: WorkspacePlacement): Promise<void> {
      const home = await resolveRepositoryCoordinationHome(placement.repositoryRoot);
      const parent = dirname(placement.workspacePath);
      await mkdir(parent, { recursive: true });
      // The worktree does not exist yet; its real path is its parent's real path and its leaf.
      const real = resolve(await realpath(parent), basename(placement.workspacePath));
      owned = ownership(placement, home.repositoryInstanceId, host, real);
      await host.provisionBranch({
        ...owned,
        branch: placement.branch,
        idempotencyKey: `idk_${hex(12)}`,
      });
    },
    /**
     * Replays the unpublished knowledge commits on the new branch, all or none, committed by
     * `Lervo Knowledge` like the originals, so the resident still recognizes them. A later commit
     * may undo part of an earlier one, as the resident's repair does, so a partial set could keep
     * bytes the set as a whole removes; the resident never publishes a partial set either. When a
     * pick conflicts, runs past its deadline, or the replay passes its budget, the branch returns
     * to its base and every commit counts as skipped. A pick that adds nothing counts as carried.
     * The owner's hooks and signing never run. When the branch cannot return to its base, the
     * start fails and rolls back.
     */
    async replayEffects(placement: WorkspacePlacement): Promise<EffectReplay> {
      const commits = placement.replay ?? [];
      const replayed: string[] = [];
      const carried: string[] = [];
      const at = placement.workspacePath;
      tip = await runGit(at, ["rev-parse", "HEAD"]);
      const started = Date.now();
      for (const commit of commits) {
        const picked = await pick(at, commit, started).catch(() => "failed" as const);
        tip = await runGit(at, ["rev-parse", "HEAD"]).catch(() => tip);
        if (picked === "failed") {
          await returnToBase(at, placement.baseCommit);
          tip = placement.baseCommit;
          return { replayed: [], skipped: [...commits], carried: [], complete: false };
        }
        (picked === "replayed" ? replayed : carried).push(commit);
      }
      return { replayed, skipped: [], carried, complete: true };
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

/**
 * Starts the workstream of the new worktree, as `lervo workstream start --apply-now` would run
 * there: its events go to the registered repository the worktree records into, bound to the
 * worktree's branch, and the worktree keeps its own current projection.
 */
export async function startWorkstreamIn(input: {
  root: string;
  title: string;
  objective: string;
}): Promise<string> {
  const roots = await resolveCommandRoots(input.root);
  const storage = await openProjectStorage(roots.evidenceRoot);
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
    await bindCheckedOutBranch(input.root, receipt.workstreamId, roots.evidenceRoot);
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
