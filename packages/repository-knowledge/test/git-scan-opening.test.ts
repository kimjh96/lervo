import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { observeGitIgnoredPaths } from "../src/git-ignored-paths.js";
import { observeGitHeadRevision } from "../src/git-revision-source.js";
import { observeGitScanOpening } from "../src/git-scan-opening.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

const probes = [
  ["build", true],
  ["build/out.txt", false],
  ["debug.log", false],
  ["kept.log", false],
  ["notes.md", false],
  ["nested", true],
  ["nested/build", true],
  ["cache", true],
] as const;

/** What the separate default observers answer, probed at the same paths. */
async function separately(root: string) {
  const revision = await observeGitHeadRevision(root);
  const ignored = await observeGitIgnoredPaths(root);
  return { revision, ignored: probes.map(([path, directory]) => ignored.ignores(path, directory)) };
}

async function combined(root: string) {
  const opening = await observeGitScanOpening(root, {});
  const ignored = await opening.observeIgnoredPaths();
  return {
    revision: opening.revisionBefore,
    ignored: probes.map(([path, directory]) => ignored.ignores(path, directory)),
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-git-scan-opening-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  for (const directory of ["", "nested/", " spaced dir/", "nested/ lead/"]) {
    await mkdir(resolve(root, directory, "build"), { recursive: true });
    await mkdir(resolve(root, directory, "cache"), { recursive: true });
    await writeFile(resolve(root, directory, ".gitignore"), "build/\n*.log\ncache/*.tmp\n");
    await writeFile(resolve(root, directory, "build/out.txt"), "output\n");
    await writeFile(resolve(root, directory, "cache/a.tmp"), "cached\n");
    await writeFile(resolve(root, directory, "debug.log"), "ignored\n");
    await writeFile(resolve(root, directory, "kept.log"), "tracked despite the pattern\n");
    await writeFile(resolve(root, directory, "notes.md"), "# Notes\n");
  }
  return root;
}

it("answers the opening revision and ignored paths exactly as the separate observers", async () => {
  const root = await repository();
  const directories = [root, resolve(root, "nested"), resolve(root, " spaced dir")];
  directories.push(resolve(root, "nested/ lead"));
  // An unborn HEAD falls back to the separate observers.
  for (const directory of directories)
    expect(await combined(directory)).toEqual(await separately(directory));
  git(root, "add", "-A");
  git(root, "add", "-f", "kept.log", "nested/kept.log");
  git(root, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "init");
  for (const directory of directories) {
    const expected = await separately(directory);
    expect(expected.revision.status).toBe("observed");
    expect(await combined(directory)).toEqual(expected);
  }
  // Detached HEAD and a scanned path inside the Git directory.
  git(root, "checkout", "-q", "--detach");
  expect(await combined(root)).toEqual(await separately(root));
  expect(await combined(resolve(root, ".git"))).toEqual(await separately(resolve(root, ".git")));
});

it("matches the separate observers outside a Git work tree", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-git-scan-opening-none-"));
  roots.push(root);
  await writeFile(resolve(root, "debug.log"), "plain\n");
  expect(await combined(root)).toEqual(await separately(root));
  expect((await combined(root)).revision.status).toBe("unavailable");
});

it("keeps injected observers as the only revision and ignore observations", async () => {
  const root = await repository();
  const revision = { status: "observed" as const, content: `${"a".repeat(40)}\n` };
  const opening = await observeGitScanOpening(root, {
    observeRevision: async () => revision,
    observeIgnoredPaths: async () => ({ ignores: () => true }),
  });
  expect(opening.revisionBefore).toBe(revision);
  expect((await opening.observeIgnoredPaths()).ignores("notes.md", false)).toBe(true);
});
