import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRepositoryFile } from "@lervo/context";
import {
  captureRepositorySnapshot,
  createCachedRepositorySnapshotCapture,
  defaultRepositorySnapshotPolicy,
} from "../src/index.js";
import { repositorySnapshotGitIgnoredPaths } from "../src/repository-snapshot-git.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-failure-"));
  roots.push(root);
  return root;
}

describe("snapshot failure boundaries", () => {
  it("distinguishes a plain directory from an unreadable Git coordinate", async () => {
    const root = await repository();
    expect(await repositorySnapshotGitIgnoredPaths(root)).toEqual({
      status: "available",
      paths: new Set(),
    });
    await writeFile(resolve(root, ".git"), "gitdir: missing-directory\n");
    expect(await repositorySnapshotGitIgnoredPaths(root)).toEqual({ status: "unavailable" });
  });

  it("never reads repository files after Git ignored paths become unavailable", async () => {
    const root = await repository();
    await writeFile(resolve(root, ".git"), "gitdir: missing-directory\n");
    await writeFile(resolve(root, "source.txt"), "source");
    let reads = 0;
    const capture = createCachedRepositorySnapshotCapture({
      readFile: async (directory, path) => {
        reads += 1;
        return readRepositoryFile(directory, path);
      },
    });
    await expect(capture(root)).rejects.toMatchObject({ code: "git_ignored_paths_unavailable" });
    expect(reads).toBe(0);
  });

  it("never reads a file beyond the entry bound", async () => {
    const root = await repository();
    for (const name of ["a", "b", "c"]) await writeFile(resolve(root, name), name);
    const paths: string[] = [];
    const capture = createCachedRepositorySnapshotCapture({
      readFile: async (directory, path) => {
        paths.push(path);
        return readRepositoryFile(directory, path);
      },
    });
    await expect(
      capture(root, { ...defaultRepositorySnapshotPolicy, maxEntries: 1 }),
    ).rejects.toMatchObject({ code: "repository_snapshot_limit_exceeded" });
    // Files are counted in walk order before any read, so the walk may stop before reading `a`,
    // but it never reads `b` or `c`.
    expect(paths.filter((path) => path !== "a")).toEqual([]);
  });

  it("rejects an expired deadline before Git or filesystem traversal", async () => {
    await expect(
      captureRepositorySnapshot("/not-read", {
        ...defaultRepositorySnapshotPolicy,
        deadlineMs: performance.now() - 1,
      }),
    ).rejects.toMatchObject({ code: "repository_snapshot_deadline_exceeded" });
  });

  it("starts no read after the deadline passes", async () => {
    const root = await repository();
    await writeFile(resolve(root, "a"), "a");
    await writeFile(resolve(root, "b"), "b");
    const policy = { ...defaultRepositorySnapshotPolicy, deadlineMs: performance.now() + 60_000 };
    const paths: string[] = [];
    const capture = createCachedRepositorySnapshotCapture({
      readFile: async (directory, path) => {
        paths.push(path);
        // Capture resolves the policy before the read; advance its monotonic clock instead. The
        // other file's read is still waiting for its stat, so it must not start.
        clock.mockReturnValue(policy.deadlineMs + 1);
        return readRepositoryFile(directory, path);
      },
    });
    const { vi } = await import("vitest");
    const clock = vi.spyOn(performance, "now");
    try {
      await expect(capture(root, policy)).rejects.toMatchObject({
        code: "repository_snapshot_deadline_exceeded",
      });
      expect(paths).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });
});
