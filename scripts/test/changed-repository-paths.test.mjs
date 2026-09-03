import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { collectChangedRepositoryPaths } from "../changed-runtime-verification/git-changes.mjs";

const execFile = promisify(execFileCallback);
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function git(root, ...arguments_) {
  await execFile("git", arguments_, { cwd: root });
}

async function repositoryFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-changed-runtime-verification-"));
  roots.push(root);
  await mkdir(resolve(root, "tracked"));
  await writeFile(resolve(root, "tracked/base.ts"), "export const base = 1;\n");
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "Lervo Test");
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize changed path fixture");
  return root;
}

describe("changed repository path observation", () => {
  it("collects modified, staged, and untracked paths without newline ambiguity", async () => {
    const root = await repositoryFixture();
    await writeFile(resolve(root, "tracked/base.ts"), "export const base = 2;\n");
    await writeFile(resolve(root, "tracked/staged.ts"), "export const staged = true;\n");
    await git(root, "add", "tracked/staged.ts");
    await writeFile(resolve(root, "untracked\nfixture.json"), "{}\n");

    await expect(collectChangedRepositoryPaths(root)).resolves.toEqual([
      "tracked/base.ts",
      "tracked/staged.ts",
      "untracked\nfixture.json",
    ]);
  });

  it("returns an empty bounded observation for a clean repository", async () => {
    const root = await repositoryFixture();
    await expect(collectChangedRepositoryPaths(root)).resolves.toEqual([]);
  });

  it("preserves a typed failure when the target is not a Git repository", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-changed-runtime-verification-invalid-"));
    roots.push(root);
    await expect(collectChangedRepositoryPaths(root)).rejects.toThrow(
      "Changed repository paths could not be observed from Git.",
    );
  });
});
