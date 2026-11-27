import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultClaimingConversationPorts } from "../src/claim-conversation.js";
import {
  defaultTerminalRootsPorts,
  resolveCommandRoots,
  resolveTerminalRoots,
  type TerminalRootsPorts,
} from "../src/terminal-roots.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
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
  keepsEvents: defaultTerminalRootsPorts.keepsEvents,
  workerCheckout: async () => worker,
});

/** The event store a run in the main checkout leaves; `.lervo/data/` is ignored, never committed. */
async function keepEvents(main: string) {
  await mkdir(join(main, ".lervo/data"), { recursive: true });
  await writeFile(join(main, ".lervo/data/events.sqlite"), "");
}

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

  it("keeps evidence local when the main checkout is neither registered nor keeps a store", async () => {
    const { worktree } = await repository();
    expect((await resolveTerminalRoots(worktree, ports([]))).reason).toBe(
      "linked_worktree_unregistered",
    );
  });

  it("records into a main checkout that keeps its store though this registry lacks it", async () => {
    const { main, worktree } = await repository();
    await keepEvents(main);
    // Such as a command run by hand beside an ADE whose user state directory registered it.
    expect(await resolveTerminalRoots(worktree, ports([]))).toEqual({
      executionRoot: worktree,
      evidenceRoot: main,
      reason: "linked_worktree",
    });
  });

  it("finds the same repository for claims, whose coordination home Git's common directory holds", async () => {
    const { base, main, worktree } = await repository();
    await keepEvents(main);
    vi.stubEnv("LERVO_USER_STATE_DIRECTORY", join(base, "other-state"));
    // Claims open the gate and read workspaces in this root's coordination home, which lives in
    // the common directory every checkout shares, so a hosted session's claims key the same home.
    expect(await defaultClaimingConversationPorts.terminalRoots(worktree)).toEqual({
      executionRoot: worktree,
      evidenceRoot: main,
      reason: "linked_worktree",
    });
  });

  it("reads no store in a main checkout that is not a Lervo project there", async () => {
    const { main, worktree } = await repository();
    await keepEvents(main);
    await rm(join(main, ".lervo/project.yaml"));
    expect((await resolveTerminalRoots(worktree, ports([]))).reason).toBe(
      "linked_worktree_unregistered",
    );
  });

  it("lets a live workforce workspace keep its evidence local beside an unregistered store", async () => {
    const { main, worktree } = await repository();
    await keepEvents(main);
    expect((await resolveTerminalRoots(worktree, ports([], true))).reason).toBe("worker_workspace");
  });

  it("lets a live workforce workspace keep its evidence local", async () => {
    const { main, worktree } = await repository();
    expect(await resolveTerminalRoots(worktree, ports([main], true))).toEqual({
      executionRoot: worktree,
      evidenceRoot: worktree,
      reason: "worker_workspace",
    });
  });

  it("warns a command once when the worktree keeps its own evidence, and hooks never", async () => {
    const { main, worktree } = await repository();
    const lines: string[] = [];
    const warn = (line: string) => void lines.push(line);
    expect((await resolveCommandRoots(worktree, ports([]), warn)).evidenceRoot).toBe(worktree);
    await resolveCommandRoots(worktree, ports([]), warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("deleted with the worktree");
    expect(lines[0]).toContain("lervo repository register");

    await resolveCommandRoots(main, ports([]), warn);
    await keepEvents(main);
    const other = await repository();
    await keepEvents(other.main);
    expect((await resolveCommandRoots(other.worktree, ports([]), warn)).evidenceRoot).toBe(
      other.main,
    );
    expect(lines).toHaveLength(1);
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
