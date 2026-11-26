import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { replaceFile } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function directory() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-replace-"));
  directories.push(path);
  return path;
}

it("replaces a file whole, owner-only by default, and leaves no temporary file", async () => {
  const root = await directory();
  const path = resolve(root, "state.json");
  await writeFile(path, "old\n", { mode: 0o644 });
  await replaceFile(path, "new\n");
  expect(await readFile(path, "utf8")).toBe("new\n");
  if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await readdir(root)).toEqual(["state.json"]);
});

it("creates a missing file with the requested mode, whatever the process mask", async () => {
  const root = await directory();
  const path = resolve(root, "fresh.bin");
  const previous = process.umask(0o077);
  try {
    await replaceFile(path, new Uint8Array([1, 2, 3]), { mode: 0o644 });
  } finally {
    process.umask(previous);
  }
  expect([...(await readFile(path))]).toEqual([1, 2, 3]);
  if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o644);
});

it.skipIf(process.platform === "win32")(
  "leaves the old file and no temporary file when the write cannot finish",
  async () => {
    const root = await directory();
    const locked = resolve(root, "locked");
    await mkdir(locked);
    const path = resolve(locked, "state.json");
    await writeFile(path, "old\n");
    await chmod(locked, 0o500);
    try {
      await expect(replaceFile(path, "new\n")).rejects.toThrow();
    } finally {
      await chmod(locked, 0o700);
    }
    expect(await readFile(path, "utf8")).toBe("old\n");
    expect(await readdir(locked)).toEqual(["state.json"]);
  },
);

it.skipIf(process.platform === "win32")(
  "replaces a link at the path instead of writing through it",
  async () => {
    const root = await directory();
    const target = resolve(root, "target.txt");
    await writeFile(target, "keep\n");
    const path = resolve(root, "link.txt");
    await symlink(target, path);
    await replaceFile(path, "new\n");
    expect(await readFile(target, "utf8")).toBe("keep\n");
    expect(await readFile(path, "utf8")).toBe("new\n");
  },
);
