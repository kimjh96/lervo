import * as fs from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readEntry } from "../src/filesystem.js";
import { readSmallEntry } from "../src/small-entry.js";

vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()) }));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(bytes: string | Uint8Array = "current") {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-small-entry-"));
  roots.push(root);
  const path = resolve(root, "source");
  await writeFile(path, bytes);
  return { root, path };
}
it.each(["", "current", "한글 😀\n", "\ufeffcurrent", "x".repeat(65536), "x".repeat(65537)])(
  "preserves complete decoding across the synchronous size boundary (case %#)",
  async (content) => {
    const { path } = await fixture(content);
    expect(await readSmallEntry(path)).toEqual(await readEntry(path));
  },
);
it("retains caller size limits and the asynchronous path for larger allowed files", async () => {
  const { path } = await fixture("x".repeat(65537));
  const reads = vi.spyOn(fs, "readSync");
  expect(await readSmallEntry(path)).toEqual({ kind: "file", content: "x".repeat(65537) });
  expect(reads).not.toHaveBeenCalled();
  expect(await readSmallEntry(path, 65536)).toMatchObject({ kind: "unsupported" });
});
it("preserves missing, directory, invalid-parent, symbolic-link and invalid-UTF8 results", async () => {
  const { root, path } = await fixture(Buffer.from([0xc3, 0x28]));
  await mkdir(resolve(root, "directory"));
  await symlink(path, resolve(root, "link"));
  for (const value of [
    path,
    resolve(root, "missing"),
    resolve(root, "directory"),
    resolve(root, "link"),
    resolve(path, "child"),
  ])
    expect(await readSmallEntry(value)).toEqual(await readEntry(value));
});
it("reads fresh bytes after same-size edits with restored mtime", async () => {
  const { path } = await fixture("before");
  const time = fs.statSync(path).mtime;
  expect(await readSmallEntry(path)).toEqual({ kind: "file", content: "before" });
  await writeFile(path, "edited");
  fs.utimesSync(path, time, time);
  expect(await readSmallEntry(path)).toEqual({ kind: "file", content: "edited" });
});
it.each(["contents", "replacement", "symlink", "growth"])(
  "rejects %s changing during a synchronous read and closes every descriptor",
  async (change) => {
    const { path } = await fixture();
    const original = fs.readSync;
    const opened = vi.spyOn(fs, "openSync");
    const closed = vi.spyOn(fs, "closeSync");
    vi.spyOn(fs, "readSync").mockImplementationOnce((...args: Parameters<typeof fs.readSync>) => {
      const count = original(...args);
      if (change === "contents") fs.writeFileSync(path, "altered");
      if (change === "growth") fs.appendFileSync(path, "x".repeat(65536));
      if (change === "replacement" || change === "symlink") {
        fs.renameSync(path, `${path}.old`);
        if (change === "replacement") fs.writeFileSync(path, "current");
        else fs.symlinkSync(`${path}.old`, path);
      }
      return count;
    });
    expect(await readSmallEntry(path)).toMatchObject({ kind: "unsupported" });
    // Mutation helpers also open descriptors; compare every successful open with closure.
    expect(new Set(closed.mock.calls.map(([fd]) => fd))).toEqual(
      new Set(opened.mock.results.filter((r) => r.type === "return").map((r) => r.value)),
    );
  },
);
it("rejects a file that grows beyond the small-read bound before opening", async () => {
  const { path } = await fixture();
  const original = fs.openSync;
  const reads = vi.spyOn(fs, "readSync");
  vi.spyOn(fs, "openSync").mockImplementationOnce((...args: Parameters<typeof fs.openSync>) => {
    fs.appendFileSync(path, "x".repeat(65536));
    return original(...args);
  });
  expect(await readSmallEntry(path)).toMatchObject({ kind: "unsupported" });
  expect(reads).not.toHaveBeenCalled();
});
