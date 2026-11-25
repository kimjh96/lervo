import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { captureRepositorySnapshot } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
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
