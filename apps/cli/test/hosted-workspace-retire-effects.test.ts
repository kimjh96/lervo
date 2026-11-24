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
