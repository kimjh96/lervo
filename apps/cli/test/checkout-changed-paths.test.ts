import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { repositoryCoordinateDigest } from "@lervo/project-storage";

import { listCheckoutChangedPaths } from "../src/checkout-changed-paths.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

async function repository(): Promise<{ root: string; base: string }> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-changed-paths-")));
  roots.push(root);
  await git(root, "init", "-q", "--initial-branch", "main");
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "config", "user.name", "Lervo Test");
  await writeFile(resolve(root, "README.md"), "app\n");
  await writeFile(resolve(root, ".gitignore"), "*.log\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "base");
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

const changed = (root: string, base: string) =>
  listCheckoutChangedPaths(root, {
    baseCommit: base,
    integrationTargetDigest: repositoryCoordinateDigest("refs/heads/main"),
    deadline: performance.now() + 10_000,
  });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("a checkout's changed paths", () => {
  it("record a new file in a new untracked directory as the file", async () => {
    const { root, base } = await repository();
    await mkdir(resolve(root, "notes/deep"), { recursive: true });
    await writeFile(resolve(root, "notes/canary.md"), "canary\n");
    await writeFile(resolve(root, "notes/deep/more.md"), "more\n");
    await writeFile(resolve(root, "notes/debug.log"), "ignored\n");
    await mkdir(resolve(root, "empty"));
    await writeFile(resolve(root, "README.md"), "changed\n");
    expect(await changed(root, base)).toEqual({
      paths: ["README.md", "notes/canary.md", "notes/deep/more.md"],
      measuredFrom: base,
    });
  });

  it("lists whole untracked directories past the file bound", async () => {
    const { root, base } = await repository();
    await mkdir(resolve(root, "bulk"));
    for (let start = 0; start <= 10_000; start += 500)
      await Promise.all(
        Array.from({ length: Math.min(500, 10_001 - start) }, (_, index) =>
          writeFile(resolve(root, `bulk/${start + index}.txt`), ""),
        ),
      );
    await writeFile(resolve(root, "single.md"), "one\n");
    expect((await changed(root, base))?.paths).toEqual(["bulk", "single.md"]);
  }, 60_000);
});
