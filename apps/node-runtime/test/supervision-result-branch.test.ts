import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { publishSupervisionResultWorkspace } from "../src/supervision-result-branch.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();

it("commits an accepted worker checkout to a create-only result branch without touching it", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-result-branch-"));
  roots.push(root);
  const repository = resolve(root, "repo");
  const worker = resolve(root, "wsp_worker");
  git(root, "init", "-q", "repo");
  await writeFile(resolve(repository, "a.txt"), "one\n");
  await writeFile(resolve(repository, ".gitignore"), "*.log\n");
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "base");
  const base = git(repository, "rev-parse", "HEAD");
  git(repository, "worktree", "add", "-q", "--detach", worker, base);
  const input = {
    path: worker,
    assignmentId: "asn_0123456789abcdef01234567",
    resultContentHash: `sha256:${"a".repeat(64)}`,
    completedAt: "2026-09-25T12:00:00.000Z",
  };
  expect(await publishSupervisionResultWorkspace(input)).toBeNull();

  await writeFile(resolve(worker, "a.txt"), "two\n");
  await writeFile(resolve(worker, "b.txt"), "new\n");
  await writeFile(resolve(worker, "debug.log"), "ignored\n");
  const published = await publishSupervisionResultWorkspace(input);
  expect(published).toMatchObject({ ref: "refs/heads/lervo/results/asn_0123456789abcdef01234567" });
  expect(git(repository, "rev-parse", "lervo/results/asn_0123456789abcdef01234567")).toBe(
    published!.commit,
  );
  expect(git(repository, "show", `${published!.commit}:a.txt`)).toBe("two");
  expect(git(repository, "ls-tree", "--name-only", published!.commit).split("\n").sort()).toEqual([
    ".gitignore",
    "a.txt",
    "b.txt",
  ]);
  expect(git(repository, "rev-parse", `${published!.commit}^`)).toBe(base);
  // The worker checkout, its index, and the user's branch are unchanged.
  expect(git(worker, "status", "--porcelain")).toContain("?? b.txt");
  expect(git(repository, "rev-parse", "HEAD")).toBe(base);
  expect(await readFile(resolve(repository, "a.txt"), "utf8")).toBe("one\n");
  // A rerun never moves the published branch.
  await writeFile(resolve(worker, "a.txt"), "three\n");
  expect(await publishSupervisionResultWorkspace(input)).toBeNull();
  expect(git(repository, "rev-parse", "lervo/results/asn_0123456789abcdef01234567")).toBe(
    published!.commit,
  );
});
