import { execFile } from "node:child_process";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  STALE_GIT_INDEX_LOCK_AGE_MS,
  staleGitIndexLock,
  staleGitIndexLockInstruction,
} from "../src/git-index-lock.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repositoryWithLock(bytes: string, ageMs: number) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-index-lock-"));
  roots.push(root);
  await execute("git", ["init", "-q", root]);
  const lock = resolve(root, ".git/index.lock");
  await writeFile(lock, bytes);
  const now = Date.now();
  const modified = new Date(now - ageMs);
  await utimes(lock, modified, modified);
  return { root, now, modified };
}

const idle = () => Promise.resolve(false);

describe("stale Git index lock", () => {
  it("names an empty lock older than the bound while no git process runs", async () => {
    const age = STALE_GIT_INDEX_LOCK_AGE_MS + 5 * 60_000;
    const { root, now, modified } = await repositoryWithLock("", age);
    const lock = await staleGitIndexLock(root, { now, gitRunning: idle });
    expect(lock).toMatchObject({ path: ".git/index.lock", ageSeconds: Math.floor(age / 1000) });
    // File systems keep whole seconds or finer, so the recorded time is within one second.
    expect(Math.abs(Date.parse(lock!.modifiedAt) - modified.getTime())).toBeLessThan(1000);
    // The owner's step names the exact file; Lervo never removes it.
    expect(staleGitIndexLockInstruction(lock!)).toContain("rm .git/index.lock");
    expect(staleGitIndexLockInstruction(lock!)).toContain("Lervo never deletes it");
  });

  it.each([
    ["a lock with content", "x", STALE_GIT_INDEX_LOCK_AGE_MS * 2, idle],
    ["a recent lock", "", STALE_GIT_INDEX_LOCK_AGE_MS - 60_000, idle],
    ["a running git process", "", STALE_GIT_INDEX_LOCK_AGE_MS * 2, () => Promise.resolve(true)],
    [
      "an unreadable process list",
      "",
      STALE_GIT_INDEX_LOCK_AGE_MS * 2,
      () => Promise.resolve(null),
    ],
  ] as const)("leaves %s to the busy check", async (_case, bytes, age, gitRunning) => {
    const { root, now } = await repositoryWithLock(bytes, age);
    await expect(staleGitIndexLock(root, { now, gitRunning })).resolves.toBeNull();
  });

  it("finds no lock where there is none", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-index-lock-"));
    roots.push(root);
    await execute("git", ["init", "-q", root]);
    await expect(staleGitIndexLock(root, { gitRunning: idle })).resolves.toBeNull();
  });
});
