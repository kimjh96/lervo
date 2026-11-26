import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { knowledgeOutputCommitSafe } from "../src/knowledge-output-commit.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

const MARKERS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
  "BISECT_LOG",
  "index.lock",
];

it("refuses every in-progress Git operation marker in a repository and a linked worktree", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-output-commit-safety-"));
  roots.push(directory);
  const root = resolve(directory, "repository");
  await mkdir(root);
  git(root, "init", "-q", "-b", "main");
  git(
    root,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  const linked = resolve(directory, "linked worktree");
  git(root, "worktree", "add", "-q", "-b", "linked", linked);
  for (const checkout of [root, linked]) {
    expect(await knowledgeOutputCommitSafe(checkout)).toBe(true);
    for (const marker of MARKERS) {
      const path = resolve(checkout, git(checkout, "rev-parse", "--git-path", marker).trim());
      if (marker.startsWith("rebase-")) await mkdir(path);
      else await writeFile(path, "");
      expect(await knowledgeOutputCommitSafe(checkout)).toBe(false);
      await rm(path, { recursive: true });
    }
    // A `REBASE_HEAD` left behind without a rebase directory names no running rebase.
    const stale = resolve(checkout, git(checkout, "rev-parse", "--git-path", "REBASE_HEAD").trim());
    await writeFile(stale, `${git(checkout, "rev-parse", "HEAD").trim()}\n`);
    expect(await knowledgeOutputCommitSafe(checkout)).toBe(true);
    await rm(stale);
  }
  // A detached HEAD is not a normal branch.
  git(linked, "checkout", "-q", "--detach");
  expect(await knowledgeOutputCommitSafe(linked)).toBe(false);
});
