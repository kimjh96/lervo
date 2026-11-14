import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

import { observeRepositoryChangeHint } from "../src/repository-change-observation.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = async (root: string, args: string[]) =>
  (await execute("git", ["-C", root, ...args])).stdout;

async function checkout(root: string) {
  const directory = async (args: string[]) => resolve(root, (await git(root, args)).trim());
  const coordinates = {
    root,
    gitDirectory: await directory(["rev-parse", "--git-dir"]),
    commonDirectory: await directory(["rev-parse", "--git-common-dir"]),
    git: (args: string[]) => git(root, args),
  };
  return { ...coordinates, hint: () => observeRepositoryChangeHint(coordinates) };
}

/** A main checkout with one commit and a linked worktree beside it. */
async function repositories() {
  const parent = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-change-hint-")));
  roots.push(parent);
  const main = resolve(parent, "main");
  await execute("git", ["init", "-q", "-b", "main", main]);
  await git(main, ["config", "user.email", "hint@example.invalid"]);
  await git(main, ["config", "user.name", "Hint"]);
  await writeFile(resolve(main, "tracked.md"), "# Tracked\n");
  await git(main, ["add", "tracked.md"]);
  await git(main, ["commit", "-q", "-m", "initial"]);
  const linked = resolve(parent, "linked");
  await git(main, ["worktree", "add", "-q", "-b", "linked", linked]);
  return { main: await checkout(main), linked: await checkout(linked) };
}

/** Moves a tracked file's timestamps without changing its bytes or the status output. */
async function touch(path: string, seconds: number) {
  const at = new Date(Date.now() - seconds * 1_000);
  await utimes(path, at, at);
}

it("reads a linked worktree's own index, not the common directory's", async () => {
  const { main, linked } = await repositories();
  expect(linked.gitDirectory).not.toBe(linked.commonDirectory);
  const before = await linked.hint();
  const mainBefore = await main.hint();
  await touch(resolve(linked.root, "tracked.md"), 60);
  await git(linked.root, ["update-index", "--refresh"]);
  expect(await linked.hint()).not.toBe(before);
  expect(await main.hint()).toBe(mainBefore);
});

it("changes when the shared exclude file changes, even with an unchanged status", async () => {
  const { main, linked } = await repositories();
  // A first observation settles anything Git itself would rewrite, so only the exclude changes.
  await Promise.all([main.hint(), linked.hint()]);
  const [mainBefore, linkedBefore] = [await main.hint(), await linked.hint()];
  expect([await main.hint(), await linked.hint()]).toEqual([mainBefore, linkedBefore]);
  await mkdir(resolve(main.commonDirectory, "info"), { recursive: true });
  await appendFile(resolve(main.commonDirectory, "info", "exclude"), "never-matches-anything/\n");
  expect(await main.hint()).not.toBe(mainBefore);
  expect(await linked.hint()).not.toBe(linkedBefore);
});

it("never refreshes the index it observes", async () => {
  const { main, linked } = await repositories();
  for (const checkout of [main, linked]) {
    await touch(resolve(checkout.root, "tracked.md"), 120);
    const index = resolve(checkout.gitDirectory, "index");
    const before = await stat(index, { bigint: true });
    const first = await checkout.hint();
    expect(await checkout.hint()).toBe(first);
    const after = await stat(index, { bigint: true });
    expect([after.mtimeNs, after.ino]).toEqual([before.mtimeNs, before.ino]);
  }
});
