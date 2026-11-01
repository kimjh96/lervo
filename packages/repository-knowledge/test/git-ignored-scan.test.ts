import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultRepositoryKnowledgePolicy, scanRepositoryKnowledge } from "../src/index.js";
import { observeGitIgnoredPaths } from "../src/git-ignored-paths.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const revision = async () => ({
  status: "observed" as const,
  content: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
});

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

/** A repository whose ignored virtual environment alone exceeds the scan's read budget. */
async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-git-ignored-scan-"));
  roots.push(root);
  git(root, "init", "-q");
  await writeFile(resolve(root, ".gitignore"), ".venv-next/\n__pycache__/\n*.log\n");
  await mkdir(resolve(root, ".venv-next/lib"), { recursive: true });
  for (let index = 0; index < 8; index += 1)
    await writeFile(resolve(root, `.venv-next/lib/module${index}.py`), "x".repeat(64 * 1024));
  await mkdir(resolve(root, "src/__pycache__"), { recursive: true });
  await writeFile(resolve(root, "src/__pycache__/main.cpython.pyc.txt"), "cached\n");
  await writeFile(resolve(root, "src/main.py"), "print('main')\n");
  await writeFile(resolve(root, "README.md"), "# Repository\n");
  await writeFile(resolve(root, "kept.log"), "tracked despite the pattern\n");
  await writeFile(resolve(root, "debug.log"), "ignored\n");
  git(root, "add", "README.md", ".gitignore");
  git(root, "add", "-f", "kept.log");
  return root;
}

const policy = {
  ...defaultRepositoryKnowledgePolicy,
  limits: { ...defaultRepositoryKnowledgePolicy.limits, maxTotalBytes: 128 * 1024 },
};

describe("Git-ignored repository paths", () => {
  it("never reads ignored untracked paths, so they cannot exhaust the read budget", async () => {
    const root = await repository();
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_gitignoredfixture",
      policy,
      observeRevision: revision,
    });
    const paths = scan.sources.map((source) => source.path);
    expect(paths).toEqual(expect.arrayContaining(["README.md", "src/main.py", "kept.log"]));
    expect(paths.some((path) => path.startsWith(".venv-next/"))).toBe(false);
    expect(paths.some((path) => path.includes("__pycache__"))).toBe(false);
    expect(paths).not.toContain("debug.log");
  });

  it("keeps reading every path outside a Git work tree", async () => {
    const root = await repository();
    await rm(resolve(root, ".git"), { recursive: true });
    await expect(
      scanRepositoryKnowledge({
        repositoryRoot: root,
        projectId: "prj_gitignoredfixture",
        policy,
        observeRevision: revision,
      }),
    ).resolves.toMatchObject({
      // Every path is read and hashed; code beyond the budget is observed only (ADR-0544).
      coverage: "complete",
      skippedForBudget: { classes: ["source_and_configuration"] },
      retention: { observedOnly: { classes: ["source_and_configuration"] } },
    });
  });

  it("reports ignored paths relative to a scanned subdirectory", async () => {
    const root = await repository();
    await mkdir(resolve(root, "nested/build"), { recursive: true });
    await writeFile(resolve(root, "nested/.gitignore"), "build/\n");
    await writeFile(resolve(root, "nested/build/out.txt"), "output\n");
    await writeFile(resolve(root, "nested/notes.md"), "# Notes\n");
    const ignored = await observeGitIgnoredPaths(resolve(root, "nested"));
    expect(ignored.ignores("build", true)).toBe(true);
    expect(ignored.ignores("notes.md", false)).toBe(false);
    expect(ignored.ignores("nested/build", true)).toBe(false);
  });
});
