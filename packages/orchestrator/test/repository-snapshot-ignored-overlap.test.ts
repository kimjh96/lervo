import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";
import { readRepositoryFile } from "@lervo/context";

import {
  captureRepositorySnapshot,
  captureRepositorySnapshotIncrementally,
  capturePersistentRepositorySnapshot,
  createCachedRepositorySnapshotCapture,
  defaultRepositorySnapshotPolicy,
  type RepositorySnapshotCacheState,
} from "../src/index.js";

// A capture with the previous capture's ignored paths walks while Git lists them again. Each case
// checks that it returns exactly what a capture without any previous state returns.
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-overlap-"));
  roots.push(root);
  execFileSync("git", ["-C", root, "init", "-q"]);
  await writeFile(resolve(root, ".gitignore"), "out/\n*.log\n");
  await mkdir(resolve(root, "src"), { recursive: true });
  await mkdir(resolve(root, "out"), { recursive: true });
  await writeFile(resolve(root, "src/main.ts"), "source\n");
  await writeFile(resolve(root, "out/bundle.js"), "ignored\n");
  // A commit lets the capture read HEAD from files, so Git lists ignored paths during the walk.
  execFileSync("git", ["-C", root, "add", ".gitignore"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "i",
  ]);
  return root;
}

async function incremental(
  root: string,
  previous?: RepositorySnapshotCacheState,
  policy = defaultRepositorySnapshotPolicy,
  reads: string[] = [],
) {
  const captured = await captureRepositorySnapshotIncrementally({
    repositoryRoot: root,
    policy,
    ...(previous === undefined ? {} : { previous }),
    readFile: (directory, path) => {
      reads.push(path);
      return readRepositoryFile(directory, path);
    },
  });
  const fresh = await captureRepositorySnapshot(root, policy);
  expect(captured.snapshot).toEqual(fresh);
  return captured;
}

it("keeps the ignored paths for the next capture", async () => {
  const root = await repository();
  const first = await incremental(root);
  expect(first.cache.ignoredPaths).toEqual(["out/"]);
  expect(Object.keys(first.snapshot.files).sort()).toEqual([".gitignore", "src/main.ts"]);
});

it("leaves out a file created since, which Git now ignores", async () => {
  const root = await repository();
  const first = await incremental(root);
  await writeFile(resolve(root, "src/debug.log"), "ignored\n");
  const second = await incremental(root, first.cache);
  expect(Object.keys(second.snapshot.files).sort()).toEqual([".gitignore", "src/main.ts"]);
  expect(second.cache.ignoredPaths).toEqual(["out/", "src/debug.log"]);
  expect(second.cache.entries.map(([path]) => path)).not.toContain("src/debug.log");
});

it("never walks a new directory Git ignores, however large", async () => {
  const root = await repository();
  const policy = { ...defaultRepositorySnapshotPolicy, maxEntries: 10 };
  const first = await incremental(root, undefined, policy);
  await writeFile(resolve(root, ".gitignore"), "out/\n*.log\ncache/\n");
  const second = await incremental(root, first.cache, policy);
  await mkdir(resolve(root, "cache"), { recursive: true });
  for (let index = 0; index < 20; index++)
    await writeFile(resolve(root, `cache/${index}.bin`), "x");
  const third = await incremental(root, second.cache, policy);
  expect(Object.keys(third.snapshot.files).sort()).toEqual([".gitignore", "src/main.ts"]);
});

it("walks a path Git stopped ignoring", async () => {
  const root = await repository();
  const first = await incremental(root);
  await writeFile(resolve(root, ".gitignore"), "*.log\n");
  const second = await incremental(root, first.cache);
  expect(Object.keys(second.snapshot.files).sort()).toEqual([
    ".gitignore",
    "out/bundle.js",
    "src/main.ts",
  ]);
  expect(second.cache.ignoredPaths).toEqual([]);
});

it("leaves out a directory Git started ignoring, and its cached hashes", async () => {
  const root = await repository();
  const first = await incremental(root);
  await writeFile(resolve(root, ".gitignore"), "out/\n*.log\nsrc/\n");
  const second = await incremental(root, first.cache);
  expect(Object.keys(second.snapshot.files)).toEqual([".gitignore"]);
  expect(second.cache.entries.map(([path]) => path)).toEqual([".gitignore"]);
});

it("reads a cache written before ignored paths were kept as a full capture", async () => {
  const root = await repository();
  const first = await incremental(root);
  const { ignoredPaths: _omitted, ...older } = first.cache;
  const second = await incremental(root, older);
  expect(second.cache.ignoredPaths).toEqual(["out/"]);
});

it("never reads a new file in a directory Git started ignoring", async () => {
  const root = await repository();
  await mkdir(resolve(root, "gen"));
  await writeFile(resolve(root, "gen/a.js"), "a\n");
  const first = await incremental(root);
  await writeFile(resolve(root, ".gitignore"), "out/\n*.log\ngen/\n");
  await writeFile(resolve(root, "gen/secret.env"), "TOKEN=x\n");
  await writeFile(resolve(root, "gen/a.js"), "changed\n");
  const reads: string[] = [];
  const second = await incremental(root, first.cache, defaultRepositorySnapshotPolicy, reads);
  expect(reads.filter((path) => path.startsWith("gen/"))).toEqual([]);
  expect(Object.keys(second.snapshot.files).sort()).toEqual([".gitignore", "src/main.ts"]);
});

it("does not fail a limit on files only the fresh list ignores, in memory or persisted", async () => {
  const root = await repository();
  await mkdir(resolve(root, "gen"));
  await writeFile(resolve(root, "gen/a.js"), "a\n");
  const policy = { ...defaultRepositorySnapshotPolicy, maxEntries: 10 };
  const cachePath = `${root}-cache.json`;
  roots.push(cachePath);
  const capture = createCachedRepositorySnapshotCapture();
  await capturePersistentRepositorySnapshot(root, cachePath, policy);
  await capture(root, policy);
  await writeFile(resolve(root, ".gitignore"), "out/\n*.log\ngen/\n");
  for (let index = 0; index < 20; index++) await writeFile(resolve(root, `gen/${index}.bin`), "x");
  const fresh = await captureRepositorySnapshot(root, policy);
  expect(Object.keys(fresh.files).sort()).toEqual([".gitignore", "src/main.ts"]);
  for (let round = 0; round < 2; round++) {
    expect(await capturePersistentRepositorySnapshot(root, cachePath, policy)).toEqual(fresh);
    expect(await capture(root, policy)).toEqual(fresh);
  }
});

it("reports a deadline Git's listing ran into as the deadline", async () => {
  const root = await repository();
  const first = await incremental(root);
  for (let round = 0; round < 3; round++) {
    const failed = await captureRepositorySnapshotIncrementally({
      repositoryRoot: root,
      previous: first.cache,
      policy: { ...defaultRepositorySnapshotPolicy, deadlineMs: performance.now() + 4 },
    }).then(
      () => null,
      (error: unknown) => (error as { code?: string }).code,
    );
    expect(failed).toBe("repository_snapshot_deadline_exceeded");
  }
});
