import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captures = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/repository-replica-git.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/repository-replica-git.js")>();
  return {
    ...original,
    captureRepositoryReplicaSnapshot: async (root: string) => {
      captures.count += 1;
      return original.captureRepositoryReplicaSnapshot(root);
    },
  };
});

const { captureRepositoryReplicaSnapshot } = await import("../src/repository-replica-git.js");
const { observeRepositoryReplicaSnapshot } =
  await import("../src/repository-replica-snapshot-cache.js");

const execute = promisify(execFile);
const roots: string[] = [];
/** Places every fixture write outside the racy window so captures may be cached. */
const settled = { nowMilliseconds: () => Date.now() + 60_000 };

async function git(root: string, ...args: string[]): Promise<string> {
  return (
    await execute("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.com",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.com",
      },
    })
  ).stdout.trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-replica-cache-"));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await writeFile(join(root, ".gitignore"), "*.log\n");
  await writeFile(join(root, "tracked.ts"), "export const value = 1;\n");
  await writeFile(join(root, "removed.ts"), "export const removed = true;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  return root;
}

/** Observes twice: the first observation may capture, the second must reflect the change. */
async function expectFreshObservation(root: string, label = "observation") {
  const before = captures.count;
  const observed = await observeRepositoryReplicaSnapshot(root, settled);
  expect(captures.count, label).toBe(before + 1);
  expect(observed, label).toEqual(await captureRepositoryReplicaSnapshot(root));
  return observed;
}

async function expectCachedObservation(root: string) {
  const before = captures.count;
  const observed = await observeRepositoryReplicaSnapshot(root, settled);
  expect(captures.count).toBe(before);
  return observed;
}

beforeEach(() => {
  captures.count = 0;
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository replica snapshot cache", () => {
  it("serves an unchanged repository from the cache with the exact fresh snapshot", async () => {
    const root = await repository();
    const first = await expectFreshObservation(root);
    const cached = await expectCachedObservation(root);
    expect(cached).toEqual(first);
    expect(cached).toEqual(await captureRepositoryReplicaSnapshot(root));
    const record = JSON.parse(
      await readFile(join(root, ".git/lervo-replica/snapshot-cache.json"), "utf8"),
    ) as { schemaVersion: number; fingerprint: string; snapshot: unknown };
    expect(record).toEqual({
      schemaVersion: 1,
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      snapshot: first,
    });
  });

  it("recaptures after every change that can alter captured bytes", async () => {
    const root = await repository();
    await expectFreshObservation(root);
    await expectCachedObservation(root);

    const edits: Array<[string, () => Promise<unknown>]> = [
      ["tracked edit", () => writeFile(join(root, "tracked.ts"), "export const value = 2;\n")],
      // A second same-size edit keeps the status line identical; only metadata reveals it.
      ["repeated edit", () => writeFile(join(root, "tracked.ts"), "export const value = 3;\n")],
      ["untracked file", () => writeFile(join(root, "added.ts"), "export const added = 1;\n")],
      ["untracked edit", () => writeFile(join(root, "added.ts"), "export const added = 2;\n")],
      ["deleted file", () => unlink(join(root, "removed.ts"))],
      ["index-only staging", () => git(root, "add", "tracked.ts")],
      [
        "staged then edited",
        () => writeFile(join(root, "tracked.ts"), "export const value = 4;\n"),
      ],
      ["moved HEAD", () => git(root, "commit", "-am", "advance")],
      ["switched branch", () => git(root, "switch", "-c", "feature")],
    ];
    const hashes = new Set<string>();
    for (const [label, edit] of edits) {
      await edit();
      const observed = await expectFreshObservation(root, label);
      hashes.add(observed.snapshotHash);
      expect(await expectCachedObservation(root)).toEqual(observed);
    }
    expect(hashes.size).toBe(edits.length);
  });

  it("keeps serving the cache for ignored files, which never enter a snapshot", async () => {
    const root = await repository();
    const first = await expectFreshObservation(root);
    await writeFile(join(root, "build.log"), "ignored\n");
    expect(await expectCachedObservation(root)).toEqual(first);
    expect(await captureRepositoryReplicaSnapshot(root)).toEqual(first);
  });

  it("never stores a fingerprint whose paths may still change within their timestamp tick", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.ts"), "export const value = 9;\n");
    await observeRepositoryReplicaSnapshot(root);
    await expect(readFile(join(root, ".git/lervo-replica/snapshot-cache.json"))).rejects.toThrow();
  });

  it("recaptures when the cache record is corrupt or forged", async () => {
    const root = await repository();
    const first = await expectFreshObservation(root);
    const path = join(root, ".git/lervo-replica/snapshot-cache.json");
    const record = JSON.parse(await readFile(path, "utf8")) as {
      snapshot: { worktreeTree: string };
    };
    record.snapshot.worktreeTree = "0".repeat(record.snapshot.worktreeTree.length);
    await writeFile(path, JSON.stringify(record));
    expect(await expectFreshObservation(root)).toEqual(first);
    await writeFile(path, "{");
    expect(await expectFreshObservation(root)).toEqual(first);
  });

  it("reports repository failures from the fresh capture, not from the fingerprint", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-replica-cache-missing-"));
    roots.push(root);
    await expect(observeRepositoryReplicaSnapshot(root, settled)).rejects.toMatchObject({
      code: "repository_replica_snapshot_failed",
    });
  });
});
