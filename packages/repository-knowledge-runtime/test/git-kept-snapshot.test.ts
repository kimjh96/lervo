import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { captureGitKeptSnapshot } from "../src/verification-source-changes.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("ignores build output Git ignores but sees every byte Git keeps", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-git-kept-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.email", "lervo-test@example.invalid");
  git("config", "user.name", "Lervo Test");
  await writeFile(resolve(root, ".gitignore"), "*.tsbuildinfo\n");
  await writeFile(resolve(root, "tracked.md"), "base\n");
  git("add", ".");
  git("commit", "-qm", "fixture");
  const before = await captureGitKeptSnapshot(root);

  // A typecheck's incremental state and Husky's self-ignoring hook directory.
  await mkdir(resolve(root, "apps/web"), { recursive: true });
  await writeFile(resolve(root, "apps/web/tsconfig.tsbuildinfo"), "{}\n");
  await mkdir(resolve(root, ".husky/_"), { recursive: true });
  await writeFile(resolve(root, ".husky/_/.gitignore"), "*\n");
  await writeFile(resolve(root, ".husky/_/pre-commit"), "#!/bin/sh\n");
  expect(await captureGitKeptSnapshot(root)).toEqual(before);

  await writeFile(resolve(root, "generated.md"), "untracked and kept\n");
  const untracked = await captureGitKeptSnapshot(root);
  expect(untracked.revision).not.toBe(before.revision);
  expect(Object.keys(untracked.files)).toContain("generated.md");
  await rm(resolve(root, "generated.md"));

  await writeFile(resolve(root, "tracked.md"), "changed\n");
  expect((await captureGitKeptSnapshot(root)).revision).not.toBe(before.revision);
  await writeFile(resolve(root, "tracked.md"), "base\n");
  expect(await captureGitKeptSnapshot(root)).toEqual(before);

  git("commit", "-q", "--allow-empty", "-m", "moved head");
  expect((await captureGitKeptSnapshot(root)).revision).not.toBe(before.revision);
});
