import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRepositoryCoordinationHome } from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  return (await execute("git", ["-C", root, ...arguments_], { env: environment })).stdout.trim();
}

describe("a project checkout that Git reads as bare", () => {
  it("is restored as a work tree, keeps its coordination home, and says so", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-bare-checkout-"));
    roots.push(root);
    await git(root, "init", "-q", "-b", "main");
    await writeFile(resolve(root, "README.md"), "# Project\n");
    await applyInitPlan(await createInitPlan({ root }));
    await git(root, "add", "-A");
    await git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init");
    const before = await resolveRepositoryCoordinationHome(root);
    expect(before.storageKind).toBe("git_common_directory");

    // A command that still pointed at the repository, such as `git init` in a hook's test, set it.
    await git(root, "config", "core.bare", "true");
    const warnings = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const after = await resolveRepositoryCoordinationHome(root);
    expect(after.root).toBe(before.root);
    expect(after.storageKind).toBe("git_common_directory");
    expect(await git(root, "config", "--get", "core.bare")).toBe("false");
    expect(String(warnings.mock.calls[0]?.[0])).toContain("restored");
  });
});
