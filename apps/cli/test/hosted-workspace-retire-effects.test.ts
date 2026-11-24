import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hostedWorkspaceRetireEffects } from "../src/hosted-workspace-retire-effects.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** A repository on `main` with one commit and a worktree on a hosted branch. */
async function repository() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-retire-")));
  roots.push(base);
  const root = join(base, "repo");
  const worktree = join(base, "repo-wt", "fix");
  const branch = "lervo/fix-the-build-1a2b3c";
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "hello\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  git(root, "worktree", "add", "-q", "-b", branch, worktree);
  return { root, worktree, branch };
}

describe("the real effects of retiring a workspace", () => {
  it("see a process working in the worktree, and none once it ends", async () => {
    const { worktree } = await repository();
    const effects = hostedWorkspaceRetireEffects();
    expect(await effects.inUse(worktree)).toBe(false);
    const child = spawn("sleep", ["30"], { cwd: worktree, stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await effects.inUse(worktree)).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    expect(await effects.inUse(worktree)).toBe(false);
  });

  it("see changes, remove a clean worktree, and delete only a merged branch", async () => {
    const { root, worktree, branch } = await repository();
    const effects = hostedWorkspaceRetireEffects();
    expect(await effects.hasChanges(worktree)).toBe(false);
    await writeFile(join(worktree, "new.txt"), "work\n");
    expect(await effects.hasChanges(worktree)).toBe(true);
    git(worktree, "add", "new.txt");
    git(worktree, "commit", "-q", "-m", "work");
    expect(await effects.hasChanges(worktree)).toBe(false);
    expect(await effects.branchMerged(root, branch)).toBe(false);
    git(root, "merge", "-q", "--ff-only", branch);
    expect(await effects.branchMerged(root, branch)).toBe(true);
    await effects.removeWorktree(root, worktree);
    expect(await effects.worktreeOf(root, branch)).toBeNull();
    expect(await effects.branchExists(root, branch)).toBe(true);
    await effects.deleteBranch(root, branch);
    expect(await effects.branchExists(root, branch)).toBe(false);
  });
});

const knowledge = {
  ...process.env,
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};

/**
 * An upstream and the owner's clone, whose `main` holds a knowledge commit upstream lacks, and a
 * hosted branch from the upstream tip with that commit replayed, as a workspace starts.
 */
async function replayedWorkspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-retire-upstream-")));
  roots.push(base);
  const remote = join(base, "remote.git");
  const root = join(base, "repo");
  const worktree = join(base, "repo-wt", "fix");
  const branch = "lervo/fix-the-build-1a2b3c";
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["clone", "-q", remote, root], { stdio: "ignore" });
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "hello\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  git(root, "push", "-q", "-u", "origin", "main");
  await writeFile(join(root, "rule.md"), "rule\n");
  git(root, "add", "rule.md");
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "apply a reviewed owner rule"], {
    env: knowledge,
  });
  const rule = git(root, "rev-parse", "HEAD");
  git(root, "worktree", "add", "-q", "-b", branch, worktree, "origin/main");
  execFileSync("git", ["-C", worktree, "cherry-pick", rule], { env: knowledge, stdio: "ignore" });
  return { root, worktree, branch, rule };
}

describe("when retiring may delete a hosted branch", () => {
  it("deletes a branch whose only commits copy knowledge commits the owner's branch holds", async () => {
    const { root, branch } = await replayedWorkspace();
    expect(await hostedWorkspaceRetireEffects().branchMerged(root, branch)).toBe(true);
  });

  it("keeps a branch with a commit made in the workspace, even one Lervo made", async () => {
    const { root, worktree, branch } = await replayedWorkspace();
    await writeFile(join(worktree, "agent-work.md"), "work\n");
    git(worktree, "add", "agent-work.md");
    execFileSync("git", ["-C", worktree, "commit", "-q", "-m", "apply knowledge"], {
      env: knowledge,
    });
    expect(await hostedWorkspaceRetireEffects().branchMerged(root, branch)).toBe(false);
  });

  it("keeps a branch with a merge, whose change no patch shows", async () => {
    const { root, worktree, branch } = await replayedWorkspace();
    // A merge whose second parent adds nothing still carries whatever its tree holds.
    const merge = git(
      worktree,
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-p",
      "origin/main",
      "-m",
      "merge",
    );
    git(worktree, "reset", "-q", "--hard", merge);
    expect(await hostedWorkspaceRetireEffects().branchMerged(root, branch)).toBe(false);
  });
});
