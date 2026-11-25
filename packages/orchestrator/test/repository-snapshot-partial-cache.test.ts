import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { readRepositoryFile } from "@lervo/context";
import { afterEach, expect, it } from "vitest";

import {
  capturePersistentRepositorySnapshot,
  captureRepositorySnapshot,
  defaultRepositorySnapshotPolicy,
  RepositorySnapshotError,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const cachedPaths = async (cache: string) =>
  (JSON.parse(await readFile(cache, "utf8")) as { entries: [string, unknown][] }).entries.length;

/** A disk that serves one read at a time, each taking 50 ms, however many a capture asks for. */
function slowDisk(): typeof readRepositoryFile {
  let queue: Promise<unknown> = Promise.resolve();
  return (base, path, maximum) => {
    const read = queue.then(async () => {
      await new Promise((done) => setTimeout(done, 50));
      return readRepositoryFile(base, path, maximum);
    });
    queue = read.catch(() => undefined);
    return read;
  };
}

it("keeps the hashes of a capture that ran out of time, so the cache warms across captures", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-partial-"));
  roots.push(root);
  for (let index = 0; index < 40; index += 1)
    await writeFile(resolve(root, `file-${String(index).padStart(2, "0")}.txt`), `${index}\n`);
  const cache = resolve(root, ".lervo/state/cache/snapshot.json");
  // Each uncached read takes 50 ms, so a 1-second deadline hashes only part of 40 files per capture.
  const slowRead = slowDisk();
  const capture = () =>
    capturePersistentRepositorySnapshot(
      root,
      cache,
      { ...defaultRepositorySnapshotPolicy, deadlineMs: performance.now() + 1000 },
      slowRead,
    );

  await expect(capture()).rejects.toMatchObject({
    code: "repository_snapshot_deadline_exceeded",
  });
  const afterFirst = await cachedPaths(cache);
  expect(afterFirst).toBeGreaterThan(0);
  expect(afterFirst).toBeLessThan(40);

  // Later captures reuse those hashes and go further, until one finishes within its deadline.
  let snapshot;
  for (let attempt = 0; attempt < 40 && snapshot === undefined; attempt += 1) {
    try {
      snapshot = await capture();
    } catch (error) {
      expect(error).toBeInstanceOf(RepositorySnapshotError);
    }
  }
  expect(snapshot).toEqual(await captureRepositorySnapshot(root));
  expect(await cachedPaths(cache)).toBe(40);
}, 30_000);

it("keys partial entries by the same stat identity as a completed capture", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-partial-identity-"));
  roots.push(root);
  for (let index = 0; index < 20; index += 1)
    await writeFile(resolve(root, `file-${String(index).padStart(2, "0")}.txt`), `${index}\n`);
  const partialCache = resolve(root, ".lervo/state/cache/partial.json");
  const fullCache = resolve(root, ".lervo/state/cache/full.json");
  const slowRead = slowDisk();
  await expect(
    capturePersistentRepositorySnapshot(
      root,
      partialCache,
      { ...defaultRepositorySnapshotPolicy, deadlineMs: performance.now() + 600 },
      slowRead,
    ),
  ).rejects.toBeInstanceOf(RepositorySnapshotError);
  await capturePersistentRepositorySnapshot(root, fullCache);
  const entries = async (path: string) =>
    new Map((JSON.parse(await readFile(path, "utf8")) as { entries: [string, unknown][] }).entries);
  const partial = await entries(partialCache);
  const full = await entries(fullCache);
  expect(partial.size).toBeGreaterThan(0);
  for (const [path, entry] of partial) expect(entry).toEqual(full.get(path));
});

it("lets two captures persist the same cache at once without failing either", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-concurrent-"));
  roots.push(root);
  for (let index = 0; index < 20; index += 1)
    await writeFile(resolve(root, `file-${index}.txt`), `${index}\n`);
  const cache = resolve(root, ".lervo/state/cache/snapshot.json");
  const [first, second] = await Promise.all([
    capturePersistentRepositorySnapshot(root, cache),
    capturePersistentRepositorySnapshot(root, cache),
  ]);
  expect(first).toEqual(second);
  expect(await cachedPaths(cache)).toBe(20);
});
