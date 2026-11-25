import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { readRepositoryFile } from "@lervo/context";
import { afterEach, expect, it, vi } from "vitest";

import {
  captureRepositorySnapshot,
  createCachedRepositorySnapshotCapture,
  defaultRepositorySnapshotPolicy,
  partialRepositorySnapshotCache,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("records files in depth-first sorted order however the concurrent walk finishes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-order-"));
  roots.push(root);
  // A deep, wide first directory finishes after the shallow ones that sort after it.
  for (let index = 0; index < 40; index++) {
    const directory = resolve(root, "a/deep/nested", `d${String(index).padStart(2, "0")}`);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "file.txt"), `content ${index}\n`);
  }
  await writeFile(resolve(root, "b.txt"), "b\n");
  await mkdir(resolve(root, "c"), { recursive: true });
  await writeFile(resolve(root, "c/z.txt"), "z\n");
  await writeFile(resolve(root, "c/a.txt"), "a\n");

  const expected = [
    ...Array.from(
      { length: 40 },
      (_, index) => `a/deep/nested/d${String(index).padStart(2, "0")}/file.txt`,
    ),
    "b.txt",
    "c/a.txt",
    "c/z.txt",
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await captureRepositorySnapshot(root);
    expect(Object.keys(snapshot.files)).toEqual(expected);
  }
});

it("reads a cold repository with more files than it opens at once", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-cold-"));
  roots.push(root);
  await mkdir(resolve(root, "many"), { recursive: true });
  await Promise.all(
    Array.from({ length: 300 }, (_, index) =>
      writeFile(resolve(root, "many", `f${String(index).padStart(3, "0")}.txt`), `${index}\n`),
    ),
  );
  const snapshot = await captureRepositorySnapshot(root);
  expect(Object.keys(snapshot.files)).toHaveLength(300);
  expect(Object.keys(snapshot.files)[0]).toBe("many/f000.txt");
});

async function repositoryWith(paths: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-concurrency-"));
  roots.push(root);
  for (const path of paths) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), `${path}\n`);
  }
  return root;
}

it("reads no more files than the entry bound allows, across directories", async () => {
  // Root files are counted before the files of a deeper directory that sorts first, so the bound
  // limits how many files are read, not which ones.
  const root = await repositoryWith(["a/p/q/r/s/1", "a/p/q/r/s/2", "a/p/q/r/s/3", "b"]);
  const paths: string[] = [];
  const capture = createCachedRepositorySnapshotCapture({
    readFile: async (directory, path) => {
      paths.push(path);
      return readRepositoryFile(directory, path);
    },
  });
  await expect(
    capture(root, { ...defaultRepositorySnapshotPolicy, maxEntries: 2 }),
  ).rejects.toMatchObject({ code: "repository_snapshot_limit_exceeded" });
  expect(paths.length).toBeLessThanOrEqual(2);
});

it("starts no waiting read once the deadline passes, and keeps the reads that were running", async () => {
  const root = await repositoryWith(
    Array.from({ length: 20 }, (_, index) => `f${String(index).padStart(2, "0")}`),
  );
  const policy = { ...defaultRepositorySnapshotPolicy, deadlineMs: performance.now() + 60_000 };
  const clock = vi.spyOn(performance, "now");
  let open!: () => void;
  const gate = new Promise<void>((done) => (open = done));
  const paths: string[] = [];
  const capture = createCachedRepositorySnapshotCapture({
    readFile: async (directory, path) => {
      paths.push(path);
      // Every read slot is busy; the other files wait for one when the deadline passes.
      if (paths.length === 8) {
        clock.mockReturnValue(policy.deadlineMs + 1);
        open();
      }
      await gate;
      return readRepositoryFile(directory, path);
    },
  });
  const error = await capture(root, policy).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ code: "repository_snapshot_deadline_exceeded" });
  expect(paths).toHaveLength(8);
  expect(
    partialRepositorySnapshotCache(error)
      ?.entries.map(([path]) => path)
      .sort(),
  ).toEqual([...paths].sort());
});

it("rejects soon after the deadline on a disk that serves one read at a time", async () => {
  const root = await repositoryWith(
    Array.from({ length: 100 }, (_, index) => `f${String(index).padStart(3, "0")}`),
  );
  let queue: Promise<unknown> = Promise.resolve();
  let finished = 0;
  const capture = createCachedRepositorySnapshotCapture({
    readFile: (directory, path) => {
      const read = queue.then(async () => {
        await new Promise((done) => setTimeout(done, 20));
        finished += 1;
        return readRepositoryFile(directory, path);
      });
      queue = read.catch(() => undefined);
      return read;
    },
  });
  const deadlineMs = performance.now() + 500;
  const error = await capture(root, { ...defaultRepositorySnapshotPolicy, deadlineMs }).catch(
    (caught: unknown) => caught,
  );
  const lag = performance.now() - deadlineMs;
  expect(error).toMatchObject({ code: "repository_snapshot_deadline_exceeded" });
  // At most eight reads of 20 ms each were running at the deadline; the persist reserve is 500 ms.
  expect(lag).toBeLessThan(400);
  // Every read that finished kept its hash.
  expect(partialRepositorySnapshotCache(error)?.entries).toHaveLength(finished);
});
