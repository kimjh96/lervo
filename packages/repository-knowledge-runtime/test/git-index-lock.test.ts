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
import {
  linuxMountType,
  processesHidden,
  windowsGitListed,
  type GitLockObservation,
} from "../src/git-lock-observation.js";

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

function observed(visible: boolean | null, local: boolean | null = true): GitLockObservation {
  return {
    gitProcessVisible: () => Promise.resolve(visible),
    localStorage: () => Promise.resolve(local),
  };
}

const old = STALE_GIT_INDEX_LOCK_AGE_MS * 2;

describe("stale Git index lock", () => {
  it("names an empty old lock on local storage while no Git process is visible", async () => {
    const age = STALE_GIT_INDEX_LOCK_AGE_MS + 5 * 60_000;
    const { root, now, modified } = await repositoryWithLock("", age);
    const lock = await staleGitIndexLock(root, { now, observation: observed(false) });
    expect(lock).toMatchObject({ path: ".git/index.lock", ageSeconds: Math.floor(age / 1000) });
    // File systems keep whole seconds or finer, so the recorded time is within one second.
    expect(Math.abs(Date.parse(lock!.modifiedAt) - modified.getTime())).toBeLessThan(1000);
    // The owner's step names the exact file; Lervo never removes it.
    const instruction = staleGitIndexLockInstruction(lock!);
    expect(instruction).toContain("no Git process is visible on this host");
    expect(instruction).toContain("rm .git/index.lock.");
    expect(instruction).toContain("Lervo never deletes it");
  });

  it.each([
    ["a lock with content", "x", old, observed(false)],
    ["a recent lock", "", STALE_GIT_INDEX_LOCK_AGE_MS - 60_000, observed(false)],
    ["a lock dated in the future", "", -60 * 60_000, observed(false)],
    ["a visible Git process", "", old, observed(true)],
    ["a process check that cannot answer", "", old, observed(null)],
    ["shared storage", "", old, observed(false, false)],
    ["storage of unknown kind", "", old, observed(false, null)],
  ] as const)("leaves %s to the busy check", async (_case, bytes, age, observation) => {
    const { root, now } = await repositoryWithLock(bytes, age);
    await expect(staleGitIndexLock(root, { now, observation })).resolves.toBeNull();
  });

  it("finds no lock where there is none", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-index-lock-"));
    roots.push(root);
    await execute("git", ["init", "-q", root]);
    await expect(staleGitIndexLock(root, { observation: observed(false) })).resolves.toBeNull();
  });
});

describe("what makes a lock provably abandoned", () => {
  it("reads Windows git.exe from tasklist CSV output", () => {
    expect(windowsGitListed('"git.exe","4120","Console","1","12,345 K"\r\n')).toBe(true);
    expect(windowsGitListed("INFO: No tasks are running which match the specified criteria.")).toBe(
      false,
    );
  });

  it("treats hidden processes as unprovable", () => {
    const proc = (options: string) => `proc /proc proc ${options} 0 0\n`;
    expect(processesHidden(proc("rw,nosuid,hidepid=2"))).toBe(true);
    expect(processesHidden(proc("rw,hidepid=invisible"))).toBe(true);
    expect(processesHidden(proc("rw,hidepid=0"))).toBe(false);
    expect(processesHidden(proc("rw,nosuid"))).toBe(false);
  });

  it("finds the deepest mount of a path, including escaped spaces", () => {
    const mounts = [
      "/dev/sdc / ext4 rw 0 0",
      "C:\\134 /mnt/c 9p rw 0 0",
      "server:/x /home/o/my\\040share nfs4 rw 0 0",
    ].join("\n");
    expect(linuxMountType(mounts, "/home/o/teams/axli/.git")).toBe("ext4");
    expect(linuxMountType(mounts, "/mnt/c/work/.git")).toBe("9p");
    expect(linuxMountType(mounts, "/home/o/my share/repo/.git")).toBe("nfs4");
  });
});
