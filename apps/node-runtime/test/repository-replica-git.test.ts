import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { watchRepositoryChanges } from "../src/repository-change-watch.js";
import { settleRepositoryWatch } from "./repository-watch.fixture.js";
import {
  applyRepositoryReplicaBundle,
  captureRepositoryReplicaSnapshot,
  createRepositoryReplicaBundle,
} from "../src/repository-replica-git.js";

const execute = promisify(execFile);
const roots: string[] = [];

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
  const root = await mkdtemp(join(tmpdir(), "lervo-replica-test-"));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await writeFile(join(root, "tracked.ts"), "export const original = true;\n");
  await writeFile(join(root, "deleted.ts"), "export const removed = true;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  return root;
}

async function clone(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-replica-clone-"));
  await rm(root, { recursive: true, force: true });
  roots.push(root);
  await execute("git", ["clone", "--quiet", source, root]);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Git repository replica", () => {
  it("preserves split index staging while observing an isolated index", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.ts"), "staged\n");
    await git(root, "add", "tracked.ts");
    await git(root, "update-index", "--split-index");
    const expectedTree = await git(root, "write-tree");
    await writeFile(join(root, "tracked.ts"), "unstaged\n");
    const before = await readFile(join(root, ".git/index"));
    const snapshot = await captureRepositoryReplicaSnapshot(root);
    expect(snapshot.indexTree).toBe(expectedTree);
    expect(snapshot.worktreeTree).not.toBe(expectedTree);
    expect(await readFile(join(root, ".git/index"))).toEqual(before);
  });

  it("does not create a self-wakeup loop from unchanged snapshot observations", async () => {
    const root = await repository();
    await captureRepositoryReplicaSnapshot(root);
    const notify = vi.fn();
    const stop = await watchRepositoryChanges(root, notify);
    try {
      await vi.waitFor(
        async () => {
          await writeFile(join(root, "tracked.ts"), "export const original = true;\n");
          expect(notify).toHaveBeenCalled();
        },
        { timeout: 10_000 },
      );
      await settleRepositoryWatch(notify);
      notify.mockClear();
      await captureRepositoryReplicaSnapshot(root);
      await captureRepositoryReplicaSnapshot(root);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(notify).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("does not create export commits during observation and still bundles exact snapshots", async () => {
    const root = await repository();
    const before = await git(root, "rev-parse", "HEAD");
    const observed = await captureRepositoryReplicaSnapshot(root);
    await expect(git(root, "rev-parse", "--verify", "refs/lervo/replica/export")).rejects.toThrow();
    expect(await git(root, "rev-parse", "HEAD")).toBe(before);
    expect((await createRepositoryReplicaBundle(root)).byteLength).toBeGreaterThan(0);
    expect((await captureRepositoryReplicaSnapshot(root)).snapshotHash).toBe(observed.snapshotHash);
  });

  it("moves incomplete, staged, unstaged, untracked, and deleted bytes without a commit", async () => {
    const source = await repository();
    const target = await clone(source);
    const common = await captureRepositoryReplicaSnapshot(target);

    await writeFile(join(source, "tracked.ts"), "export const staged = true;\n");
    await git(source, "add", "tracked.ts");
    await writeFile(join(source, "tracked.ts"), "export const a =");
    await rm(join(source, "deleted.ts"));
    await mkdir(join(source, "nested"));
    await writeFile(join(source, "nested", "new.ts"), "const unfinished =");

    const sourceSnapshot = await captureRepositoryReplicaSnapshot(source);
    const bundle = await createRepositoryReplicaBundle(source);
    const applied = await applyRepositoryReplicaBundle({
      repositoryRoot: target,
      bundle,
      expectedCurrentSnapshotHash: common.snapshotHash,
    });

    expect(applied).toEqual(sourceSnapshot);
    expect(await readFile(join(target, "tracked.ts"), "utf8")).toBe("export const a =");
    expect(await readFile(join(target, "nested", "new.ts"), "utf8")).toBe("const unfinished =");
    await expect(readFile(join(target, "deleted.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await git(target, "diff", "--cached", "--", "tracked.ts")).toContain(
      "export const staged = true;",
    );
    expect(await git(target, "status", "--short")).toBe(await git(source, "status", "--short"));

    await writeFile(join(source, "tracked.ts"), "const a = 1;");
    const nextSourceSnapshot = await captureRepositoryReplicaSnapshot(source);
    const nextApplied = await applyRepositoryReplicaBundle({
      repositoryRoot: target,
      bundle: await createRepositoryReplicaBundle(source),
      expectedCurrentSnapshotHash: applied.snapshotHash,
    });
    expect(nextApplied).toEqual(nextSourceSnapshot);
    expect(await readFile(join(target, "tracked.ts"), "utf8")).toBe("const a = 1;");
  });

  it("rejects an apply when the target moved after reconciliation", async () => {
    const source = await repository();
    const target = await clone(source);
    const common = await captureRepositoryReplicaSnapshot(target);
    await writeFile(join(source, "tracked.ts"), "source\n");
    const bundle = await createRepositoryReplicaBundle(source);
    await writeFile(join(target, "tracked.ts"), "target\n");

    await expect(
      applyRepositoryReplicaBundle({
        repositoryRoot: target,
        bundle,
        expectedCurrentSnapshotHash: common.snapshotHash,
      }),
    ).rejects.toMatchObject({ code: "repository_replica_conflict" });
    expect(await readFile(join(target, "tracked.ts"), "utf8")).toBe("target\n");
  });

  it("rejects divergent committed history without moving either branch", async () => {
    const source = await repository();
    const target = await clone(source);
    await writeFile(join(source, "tracked.ts"), "source commit\n");
    await git(source, "commit", "-am", "source change");
    await writeFile(join(target, "tracked.ts"), "target commit\n");
    await git(target, "commit", "-am", "target change");
    const targetBefore = await captureRepositoryReplicaSnapshot(target);
    const bundle = await createRepositoryReplicaBundle(source);

    await expect(
      applyRepositoryReplicaBundle({
        repositoryRoot: target,
        bundle,
        expectedCurrentSnapshotHash: targetBefore.snapshotHash,
      }),
    ).rejects.toMatchObject({ code: "repository_replica_conflict" });
    expect(await captureRepositoryReplicaSnapshot(target)).toEqual(targetBefore);
    expect(await readFile(join(target, "tracked.ts"), "utf8")).toBe("target commit\n");
  });

  it("explicitly seeds a divergent replica while retaining an exact recovery ref", async () => {
    const source = await repository();
    const target = await clone(source);
    await git(target, "switch", "-c", "deployment");
    await writeFile(join(target, "tracked.ts"), "recover me without a commit\n");
    const targetBefore = await captureRepositoryReplicaSnapshot(target);
    await writeFile(join(source, "tracked.ts"), "source commit\n");
    await git(source, "commit", "-am", "source change");
    await writeFile(join(source, "tracked.ts"), "const a =");
    const sourceSnapshot = await captureRepositoryReplicaSnapshot(source);

    const applied = await applyRepositoryReplicaBundle({
      repositoryRoot: target,
      bundle: await createRepositoryReplicaBundle(source),
      expectedCurrentSnapshotHash: targetBefore.snapshotHash,
      allowHistoryReplacement: true,
    });

    expect(applied).toEqual(sourceSnapshot);
    expect(await git(target, "branch", "--show-current")).toBe("main");
    expect(await readFile(join(target, "tracked.ts"), "utf8")).toBe("const a =");
    expect(
      await git(
        target,
        "show",
        `refs/lervo/replica/recovery/${targetBefore.snapshotHash.slice("sha256:".length)}:tracked.ts`,
      ),
    ).toBe("recover me without a commit");
  });
});
