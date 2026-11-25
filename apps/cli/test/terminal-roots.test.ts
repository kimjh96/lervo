import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultTerminalRootsPorts,
  resolveTerminalRoots,
  type TerminalRootsPorts,
} from "../src/terminal-roots.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  run("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=T", ...args], { cwd });

/** A main checkout with a Lervo project at `project` (relative), committed, and a linked worktree. */
async function repository(project = "") {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-roots-")));
  roots.push(base);
  const main = join(base, "main");
  await mkdir(join(main, project, ".lervo"), { recursive: true });
  await writeFile(join(main, project, ".lervo/project.yaml"), "name: app\n");
  await git(base, "init", "-q", "--initial-branch", "main", main);
  await git(main, "add", "-A");
  await git(main, "commit", "-q", "-m", "base");
  const worktree = join(base, "worktree");
  await git(main, "worktree", "add", "-q", "-b", "work", worktree);
  return { base, main, worktree, project };
}

const ports = (registered: string[], worker = false): TerminalRootsPorts => ({
  gitCoordinates: defaultTerminalRootsPorts.gitCoordinates,
  registeredRoots: async () => registered,
  workerCheckout: async () => worker,
});

describe("a terminal session's roots", () => {
  it("keeps a main checkout's evidence where it runs", async () => {
    const { main } = await repository();
    expect(await resolveTerminalRoots(main, ports([main]))).toEqual({
      executionRoot: main,
      evidenceRoot: main,
      reason: "checkout",
    });
  });

  it("records a registered repository's linked worktree in the repository, from any subdirectory", async () => {
    const { main, worktree } = await repository();
    await mkdir(join(worktree, "src/deep"), { recursive: true });
    expect(await resolveTerminalRoots(join(worktree, "src/deep"), ports([main]))).toEqual({
      executionRoot: worktree,
      evidenceRoot: main,
      reason: "linked_worktree",
    });
  });

  it("matches through symbolic links on either side", async () => {
    const { base, main, worktree } = await repository();
    await symlink(worktree, join(base, "linked-worktree"));
    const viaLink = await resolveTerminalRoots(join(base, "linked-worktree"), ports([main]));
    expect(viaLink.reason).toBe("linked_worktree");
    expect(viaLink.evidenceRoot).toBe(main);
  });

  it("maps a project below the Git top level to the same place in the main checkout", async () => {
    const { main, worktree } = await repository("services/app");
    const result = await resolveTerminalRoots(
      join(worktree, "services/app"),
      ports([join(main, "services/app")]),
    );
    expect(result).toEqual({
      executionRoot: join(worktree, "services/app"),
      evidenceRoot: join(main, "services/app"),
      reason: "linked_worktree",
    });
  });

  it("keeps evidence local when no registered repository owns the main checkout", async () => {
    const { worktree } = await repository();
    expect((await resolveTerminalRoots(worktree, ports([]))).reason).toBe(
      "linked_worktree_unregistered",
    );
  });

  it("lets a live workforce workspace keep its evidence local", async () => {
    const { main, worktree } = await repository();
    expect(await resolveTerminalRoots(worktree, ports([main], true))).toEqual({
      executionRoot: worktree,
      evidenceRoot: worktree,
      reason: "worker_workspace",
    });
  });

  it("keeps evidence local for a bare repository's worktree", async () => {
    const { base, main } = await repository();
    const bare = join(base, "bare.git");
    await git(base, "clone", "-q", "--bare", main, bare);
    const worktree = join(base, "bare-worktree");
    await git(bare, "worktree", "add", "-q", "-b", "other", worktree);
    expect((await resolveTerminalRoots(worktree, ports([main]))).reason).toBe(
      "linked_worktree_unresolved",
    );
  });
});
