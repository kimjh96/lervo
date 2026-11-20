import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { watchRepositoryChanges } from "@lervo/repository-knowledge-runtime";
import {
  applyRepositoryReplicaBundle,
  captureRepositoryReplicaSnapshot,
  createRepositoryReplicaBundle,
} from "../src/repository-replica-git.js";
import { observeRepositoryReplicaSnapshot } from "../src/repository-replica-snapshot-cache.js";

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
    const stop = await watchRepositoryChanges(root, notify, notify);
    // The watcher reacts to these Git files and to root entries, so comparing their exact bytes
    // proves an observation cannot wake itself. Waiting for a notification that must never
    // arrive could only ever prove that it had not arrived yet.
    const watchedBytes = async () =>
      JSON.stringify([
        (await readdir(root)).sort(),
        await Promise.all(
          ["HEAD", "index", "packed-refs", "config"].map((name) =>
            readFile(join(root, ".git", name), "base64").catch(() => null),
          ),
        ),
      ]);
    try {
      await vi.waitFor(
        async () => {
          await writeFile(join(root, "tracked.ts"), "export const original = true;\n");
          expect(notify).toHaveBeenCalled();
        },
        { timeout: 10_000 },
      );
      const before = await watchedBytes();
      await captureRepositoryReplicaSnapshot(root);
      await captureRepositoryReplicaSnapshot(root);
      // Cached observation reads status without optional locks and writes only its own cache.
      const settled = { nowMilliseconds: () => Date.now() + 60_000 };
      await observeRepositoryReplicaSnapshot(root, settled);
      await observeRepositoryReplicaSnapshot(root, settled);
      expect(await watchedBytes()).toBe(before);
    } finally {
      stop();
    }
  }, 15_000);

  it("re-hashes a same-size edit made in the timestamp second of the last index write", async () => {
    const root = await repository();
    // Commit and a same-size edit share one timestamp second, and capture runs in a later second.
    // Where Git compares whole seconds, only its racy check against the index timestamp reveals
    // the edit, so the observed index copy must not look newer than the user's index.
    while (Date.now() % 1_000 > 200) await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(join(root, "tracked.ts"), "export const original = 1;\n");
    await git(root, "commit", "-qam", "same second");
    await writeFile(join(root, "tracked.ts"), "export const original = 2;\n");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const snapshot = await captureRepositoryReplicaSnapshot(root);
    expect(await git(root, "rev-parse", `${snapshot.worktreeTree}:tracked.ts`)).toBe(
      await git(root, "hash-object", "tracked.ts"),
    );
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

  it("does not substitute newer source bytes into a snapshot-bound bundle", async () => {
    const root = await repository();
    const selected = await captureRepositoryReplicaSnapshot(root);
    await writeFile(join(root, "tracked.ts"), "export const advanced = true;\n");

    await expect(createRepositoryReplicaBundle(root, selected.snapshotHash)).rejects.toMatchObject({
      code: "repository_replica_conflict",
    });
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
  }, 15_000);

  it("retains a host-local convergence grant while applying a new ignore rule", async () => {
    const source = await repository();
    const target = await clone(source);
    const localGrant = join(target, ".lervo/knowledge/convergence-delegation.json");
    await mkdir(join(target, ".lervo/knowledge"), { recursive: true });
    await writeFile(localGrant, "target-host-reviewed-grant\n");
    // Both sides begin at the same snapshot before either has an ignore rule.
    const common = await captureRepositoryReplicaSnapshot(target);
    await mkdir(join(source, ".lervo"), { recursive: true });
    await writeFile(
      join(source, ".lervo/.gitignore"),
      "data/\nstate/\nknowledge/convergence-delegation.json\n",
    );
    await writeFile(join(source, "tracked.ts"), "export const source = true;\n");

    const applied = await applyRepositoryReplicaBundle({
      repositoryRoot: target,
      bundle: await createRepositoryReplicaBundle(source),
      expectedCurrentSnapshotHash: common.snapshotHash,
    });

    expect(applied).toEqual(await captureRepositoryReplicaSnapshot(source));
    expect(await readFile(localGrant, "utf8")).toBe("target-host-reviewed-grant\n");
    expect(await git(target, "check-ignore", ".lervo/knowledge/convergence-delegation.json")).toBe(
      ".lervo/knowledge/convergence-delegation.json",
    );
  });

  describe("a delegation that HEAD tracks (ADR-0478)", () => {
    const delegationPath = ".lervo/knowledge/convergence-delegation.json";

    async function trackedGrantPair(): Promise<{ owner: string; follower: string }> {
      const owner = await repository();
      await mkdir(join(owner, ".lervo/knowledge"), { recursive: true });
      await writeFile(join(owner, ".lervo/.gitignore"), "knowledge/convergence-delegation.json\n");
      await writeFile(join(owner, delegationPath), "committed-grant\n");
      await git(owner, "add", "-f", ".lervo/.gitignore", delegationPath);
      await git(owner, "commit", "-m", "track grant");
      return { owner, follower: await clone(owner) };
    }

    it("carries the owner's renewal to the follower byte for byte", async () => {
      const { owner, follower } = await trackedGrantPair();
      const common = await captureRepositoryReplicaSnapshot(follower);
      await writeFile(join(owner, delegationPath), "owner-renewed-grant\n");
      expect((await captureRepositoryReplicaSnapshot(owner)).snapshotHash).not.toBe(
        common.snapshotHash,
      );

      const applied = await applyRepositoryReplicaBundle({
        repositoryRoot: follower,
        bundle: await createRepositoryReplicaBundle(owner),
        expectedCurrentSnapshotHash: common.snapshotHash,
      });

      expect(applied).toEqual(await captureRepositoryReplicaSnapshot(owner));
      expect(await readFile(join(follower, delegationPath), "utf8")).toBe("owner-renewed-grant\n");
      expect(await git(follower, "rev-parse", "HEAD")).toBe(await git(owner, "rev-parse", "HEAD"));
    });

    it("keeps a renewed delegation while applying an unrelated change", async () => {
      const { owner, follower } = await trackedGrantPair();
      await writeFile(join(owner, delegationPath), "owner-renewed-grant\n");
      await writeFile(join(follower, delegationPath), "owner-renewed-grant\n");
      const common = await captureRepositoryReplicaSnapshot(follower);
      // An upgrade on the owner rewrites generated files; the reset must not restore HEAD's grant.
      await writeFile(join(owner, "tracked.ts"), "export const upgraded = true;\n");

      await applyRepositoryReplicaBundle({
        repositoryRoot: follower,
        bundle: await createRepositoryReplicaBundle(owner),
        expectedCurrentSnapshotHash: common.snapshotHash,
      });

      expect(await readFile(join(follower, delegationPath), "utf8")).toBe("owner-renewed-grant\n");
      expect(await readFile(join(follower, "tracked.ts"), "utf8")).toBe(
        "export const upgraded = true;\n",
      );
    });
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
