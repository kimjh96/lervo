import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitWorkspaceEffects } from "../src/workspace-start-effects.js";
import type { WorkspacePlacement } from "../src/workspace-start.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const knowledge = {
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};

async function commitFile(root: string, file: string, text: string, message: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
  git(root, "add", file);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", message], {
    env: { ...process.env, ...knowledge },
  });
  return git(root, "rev-parse", "HEAD");
}

/**
 * The owner's repository with knowledge commits on `main`, and a hosted branch in a worktree at
 * the commit before them, as a workspace starts from an upstream tip that lacks them.
 */
async function workspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-replay-")));
  roots.push(base);
  const root = join(base, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.email", "owner@example.invalid");
  git(root, "config", "user.name", "Owner");
  await commitFile(root, "README.md", "hello\n", "first");
  const start = git(root, "rev-parse", "HEAD");
  const branch = "lervo/fix-the-build-1a2b3c";
  const workspacePath = join(base, "repo-wt", "fix-the-build-1a2b3c");
  git(root, "worktree", "add", "-q", "-b", branch, workspacePath, start);
  const placement = (replay: string[]): WorkspacePlacement => ({
    repositoryRoot: root,
    projectId: "prj_0123456789abcdef",
    workspaceId: "wsp_0123456789abcdef01234567",
    branch,
    workspacePath,
    baseCommit: start,
    replay,
  });
  return { root, start, branch, workspacePath, placement };
}

describe("replaying knowledge commits on a new workspace branch", () => {
  it("commits each as Lervo Knowledge, without the owner's hooks or signing", async () => {
    const { root, start, workspacePath, placement } = await workspace();
    const rule = await commitFile(root, "docs/rule.md", "rule\n", "apply a reviewed owner rule");
    const marker = join(root, "hook-ran");
    await writeFile(join(root, ".git/hooks/post-commit"), `#!/bin/sh\ntouch ${marker}\n`);
    await chmod(join(root, ".git/hooks/post-commit"), 0o755);
    git(root, "config", "commit.gpgSign", "true");
    git(root, "config", "gpg.program", "false");
    const replay = await gitWorkspaceEffects().replayEffects(placement([rule]));
    expect(replay).toEqual({ replayed: [rule], skipped: [], carried: [] });
    expect(git(workspacePath, "rev-parse", "HEAD^")).toBe(start);
    expect(git(workspacePath, "log", "-1", "--format=%an <%ae>|%cn <%ce>|%s")).toBe(
      "Lervo Knowledge <knowledge@lervo.invalid>|Lervo Knowledge <knowledge@lervo.invalid>|apply a reviewed owner rule",
    );
    await expect(stat(marker)).rejects.toThrow();
  });

  it("carries a commit the branch already holds and skips one that conflicts", async () => {
    const { root, workspacePath, placement } = await workspace();
    const held = await commitFile(root, "docs/held.md", "held\n", "apply knowledge");
    const conflicting = await commitFile(root, "README.md", "theirs\n", "rewrite the readme");
    await commitFile(workspacePath, "docs/held.md", "held\n", "the same change");
    await commitFile(workspacePath, "README.md", "ours\n", "another readme");
    const before = git(workspacePath, "rev-parse", "HEAD");
    const replay = await gitWorkspaceEffects().replayEffects(placement([held, conflicting]));
    expect(replay).toEqual({ replayed: [], skipped: [conflicting], carried: [held] });
    expect(git(workspacePath, "rev-parse", "HEAD")).toBe(before);
    expect(git(workspacePath, "status", "--porcelain")).toBe("");
  });

  it("rolls back the branch at its tip after the replay", async () => {
    const { root, branch, workspacePath, placement } = await workspace();
    const rule = await commitFile(root, "docs/rule.md", "rule\n", "apply knowledge");
    const effects = gitWorkspaceEffects();
    await effects.replayEffects(placement([rule]));
    git(root, "worktree", "remove", "--force", workspacePath);
    await effects.removeWorkspace(placement([rule]));
    expect(git(root, "branch", "--list", branch)).toBe("");
  });
});
