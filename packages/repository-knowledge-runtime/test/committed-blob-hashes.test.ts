import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { observeProcessCost } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { committedBlobHashes } from "../src/committed-blob-hashes.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** The former per-path read, kept here as the reference each batched answer must equal. */
async function perPathHash(root: string, revision: string, path: string) {
  try {
    const { stdout } = await execute(
      "git",
      ["-C", root, "cat-file", "blob", `${revision}:${path}`],
      {
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return `sha256:${createHash("sha256").update(stdout).digest("hex")}`;
  } catch {
    return null;
  }
}

const PATHS = [
  "plain.md",
  "empty.txt",
  "binary.bin",
  "large.bin",
  "with space/file name.md",
  "unicodé/ファイル.md",
  "line\nbreak.md",
  "link.md",
  "dangling-link",
  "directory",
  "directory/nested.md",
  "submodule",
  "missing.md",
  "../escape.md",
];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-committed-blobs-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "blobs@example.invalid");
  git(root, "config", "user.name", "Blobs");
  await writeFile(resolve(root, "plain.md"), "# Plain\n");
  await writeFile(resolve(root, "empty.txt"), "");
  await writeFile(resolve(root, "binary.bin"), Buffer.from([0, 1, 2, 255, 10, 0, 10, 13]));
  // Several pipe buffers, so one body spans many stream chunks.
  await writeFile(
    resolve(root, "large.bin"),
    Buffer.from(Array.from({ length: 5 * 1024 * 1024 + 7 }, (_, index) => index % 251)),
  );
  await mkdir(resolve(root, "with space"));
  await writeFile(resolve(root, "with space/file name.md"), "spaced\n");
  await mkdir(resolve(root, "unicodé"));
  await writeFile(resolve(root, "unicodé/ファイル.md"), "unicode\n");
  await writeFile(resolve(root, "line\nbreak.md"), "newline path\n");
  await symlink("plain.md", resolve(root, "link.md"));
  await symlink("nowhere", resolve(root, "dangling-link"));
  await mkdir(resolve(root, "directory"));
  await writeFile(resolve(root, "directory/nested.md"), "nested\n");
  git(root, "add", "-A");
  // A gitlink entry whose commit object is absent from this repository, as for a submodule.
  git(root, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},submodule`);
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

it("answers every path exactly as a separate `cat-file blob` does", async () => {
  const root = await repository();
  const head = git(root, "rev-parse", "HEAD");
  for (const revision of ["HEAD", head, `${head}^{tree}`, "main"]) {
    const batched = await committedBlobHashes(root, revision, PATHS);
    const expected = await Promise.all(PATHS.map((path) => perPathHash(root, revision, path)));
    expect(PATHS.map((path) => batched.get(path))).toEqual(expected);
  }
  const answers = await committedBlobHashes(root, "HEAD", PATHS);
  expect(answers.get("plain.md")).not.toBeNull();
  expect(answers.get("link.md")).toBe(
    `sha256:${createHash("sha256").update("plain.md").digest("hex")}`,
  );
  for (const absent of ["directory", "submodule", "missing.md", "../escape.md"])
    expect(answers.get(absent)).toBeNull();
});

it("answers absent for an unknown revision and an empty request without a process", async () => {
  const root = await repository();
  expect([...(await committedBlobHashes(root, "no-such-ref", ["plain.md"]))]).toEqual([
    ["plain.md", null],
  ]);
  const observation = observeProcessCost();
  try {
    expect((await committedBlobHashes(root, "HEAD", [])).size).toBe(0);
    expect(observation.snapshot().gitProcesses).toBe(0);
  } finally {
    observation.close();
  }
});

it("reads one process per call and none for a remembered object identity", async () => {
  const root = await repository();
  const head = git(root, "rev-parse", "HEAD");
  const observation = observeProcessCost();
  try {
    const first = await committedBlobHashes(root, head, ["plain.md", "binary.bin"]);
    expect(observation.snapshot().gitProcesses).toBe(1);
    expect(await committedBlobHashes(root, head, ["binary.bin", "plain.md"])).toEqual(
      new Map([
        ["binary.bin", first.get("binary.bin")!],
        ["plain.md", first.get("plain.md")!],
      ]),
    );
    expect(observation.snapshot().gitProcesses).toBe(1);
    // A remembered tree does not stand in for an absent path, which is read again.
    await committedBlobHashes(root, head, ["plain.md", "missing.md"]);
    expect(observation.snapshot().gitProcesses).toBe(2);
  } finally {
    observation.close();
  }
});

it("follows HEAD when it moves", async () => {
  const root = await repository();
  const before = (await committedBlobHashes(root, "HEAD", ["plain.md"])).get("plain.md");
  await writeFile(resolve(root, "plain.md"), "# Changed\n");
  git(root, "commit", "-q", "-am", "change");
  const after = (await committedBlobHashes(root, "HEAD", ["plain.md"])).get("plain.md");
  expect(after).not.toBe(before);
  expect(after).toBe(await perPathHash(root, "HEAD", "plain.md"));
});
