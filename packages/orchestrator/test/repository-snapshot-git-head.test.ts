import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { gitHeadFromFiles } from "../src/repository-snapshot-git.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd })
    .toString()
    .trim();

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-head-"));
  roots.push(root);
  git(root, "init", "--quiet", "-b", "main");
  return root;
}

async function committed() {
  const root = await repository();
  await writeFile(resolve(root, "a.txt"), "a\n");
  git(root, "add", "a.txt");
  git(root, "commit", "--quiet", "-m", "a");
  return root;
}

it("reads HEAD through a loose ref, as git rev-parse does", async () => {
  const root = await committed();
  expect(await gitHeadFromFiles(root)).toBe(git(root, "rev-parse", "HEAD"));
});

it("reads HEAD through packed refs and a detached HEAD", async () => {
  const root = await committed();
  git(root, "pack-refs", "--all", "--prune");
  expect(await gitHeadFromFiles(root)).toBe(git(root, "rev-parse", "HEAD"));
  git(root, "checkout", "--quiet", "--detach");
  expect(await gitHeadFromFiles(root)).toBe(git(root, "rev-parse", "HEAD"));
});

it("reads a linked worktree's own HEAD", async () => {
  const root = await committed();
  const worktree = `${root}-worktree`;
  roots.push(worktree);
  git(root, "worktree", "add", "--quiet", "-b", "side", worktree);
  await writeFile(resolve(worktree, "b.txt"), "b\n");
  git(worktree, "add", "b.txt");
  git(worktree, "commit", "--quiet", "-m", "b");
  expect(await gitHeadFromFiles(worktree)).toBe(git(worktree, "rev-parse", "HEAD"));
  expect(await gitHeadFromFiles(root)).toBe(git(root, "rev-parse", "HEAD"));
});

it("leaves an unborn branch, a repository override, and a broken HEAD to git", async () => {
  expect(await gitHeadFromFiles(await repository())).toBeUndefined();
  const root = await committed();
  vi.stubEnv("GIT_DIR", resolve(root, ".git"));
  expect(await gitHeadFromFiles(root)).toBeUndefined();
  vi.unstubAllEnvs();
  await writeFile(resolve(root, ".git", "HEAD"), "ref: ../outside\n");
  expect(await gitHeadFromFiles(root)).toBeUndefined();
});
