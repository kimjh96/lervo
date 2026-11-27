import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hostedWorkspaceRetireEffects } from "../src/hosted-workspace-retire-effects.js";
import {
  NestedRepositoryChanges,
  expiredRetiredChanges,
  RETIRED_CHANGES_KEPT,
  RETIRED_CHANGES_PREFIX,
} from "../src/retired-workspace-changes.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** A repository on `main` with one commit and a worktree on a hosted branch. */
async function repository() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-retire-")));
  roots.push(base);
  const root = join(base, "repo");
  const worktree = join(base, "repo-wt", "fix");
  const branch = "lervo/fix-the-build-1a2b3c";
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "hello\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  git(root, "worktree", "add", "-q", "-b", branch, worktree);
  return { root, worktree, branch };
}

describe("the real effects of retiring a workspace", () => {
  it("see a process working in the worktree, and none once it ends", async () => {
    const { worktree } = await repository();
    const effects = hostedWorkspaceRetireEffects();
    expect(await effects.inUse(worktree)).toBe(false);
    const child = spawn("sleep", ["30"], { cwd: worktree, stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await effects.inUse(worktree)).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    expect(await effects.inUse(worktree)).toBe(false);
  });

  it("see changes, remove a clean worktree, and delete only a merged branch", async () => {
    const { root, worktree, branch } = await repository();
    const effects = hostedWorkspaceRetireEffects();
    expect(await effects.hasChanges(worktree)).toBe(false);
    await writeFile(join(worktree, "new.txt"), "work\n");
    expect(await effects.hasChanges(worktree)).toBe(true);
    git(worktree, "add", "new.txt");
    git(worktree, "commit", "-q", "-m", "work");
    expect(await effects.hasChanges(worktree)).toBe(false);
    expect(await effects.branchMerged(root, branch)).toBe(false);
    git(root, "merge", "-q", "--ff-only", branch);
    expect(await effects.branchMerged(root, branch)).toBe(true);
    await effects.removeWorktree(root, worktree, false);
    expect(await effects.worktreeOf(root, branch)).toBeNull();
    expect(await effects.branchExists(root, branch)).toBe(true);
    await effects.deleteBranch(root, branch);
    expect(await effects.branchExists(root, branch)).toBe(false);
  });
});

const knowledge = {
  ...process.env,
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};

/**
 * An upstream and the owner's clone, whose `main` holds a knowledge commit upstream lacks, and a
 * hosted branch from the upstream tip with that commit replayed, as a workspace starts.
 */
async function replayedWorkspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-retire-upstream-")));
  roots.push(base);
  const remote = join(base, "remote.git");
  const root = join(base, "repo");
  const worktree = join(base, "repo-wt", "fix");
  const branch = "lervo/fix-the-build-1a2b3c";
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["clone", "-q", remote, root], { stdio: "ignore" });
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "hello\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  git(root, "push", "-q", "-u", "origin", "main");
  await writeFile(join(root, "rule.md"), "rule\n");
  git(root, "add", "rule.md");
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "apply a reviewed owner rule"], {
    env: knowledge,
  });
  const rule = git(root, "rev-parse", "HEAD");
  git(root, "worktree", "add", "-q", "-b", branch, worktree, "origin/main");
  execFileSync("git", ["-C", worktree, "cherry-pick", rule], { env: knowledge, stdio: "ignore" });
  return { root, worktree, branch, rule };
}

describe("when retiring may delete a hosted branch", () => {
  it("deletes a branch whose only commits copy knowledge commits the owner's branch holds", async () => {
    const { root, branch } = await replayedWorkspace();
    expect(await hostedWorkspaceRetireEffects().branchMerged(root, branch)).toBe(true);
  });

  it("keeps a branch with a commit made in the workspace, even one Lervo made", async () => {
    const { root, worktree, branch } = await replayedWorkspace();
    await writeFile(join(worktree, "agent-work.md"), "work\n");
    git(worktree, "add", "agent-work.md");
    execFileSync("git", ["-C", worktree, "commit", "-q", "-m", "apply knowledge"], {
      env: knowledge,
    });
    expect(await hostedWorkspaceRetireEffects().branchMerged(root, branch)).toBe(false);
  });

  it("keeps a branch with a merge, whose change no patch shows", async () => {
    const { root, worktree, branch } = await replayedWorkspace();
    // A merge whose second parent adds nothing still carries whatever its tree holds.
    const merge = git(
      worktree,
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-p",
      "origin/main",
      "-m",
      "merge",
    );
    git(worktree, "reset", "-q", "--hard", merge);
    expect(await hostedWorkspaceRetireEffects().branchMerged(root, branch)).toBe(false);
  });

  it("keep a copy of the changes, then remove the worktree with them", async () => {
    const { root, worktree } = await repository();
    const effects = hostedWorkspaceRetireEffects();
    await writeFile(join(worktree, "README.md"), "changed\n");
    await writeFile(join(worktree, "new.txt"), "untracked\n");
    // Lervo's own state stays out of the copy, ignored as a repository's rules ignore it or not.
    await writeFile(join(worktree, ".git-info-exclude"), "");
    git(worktree, "config", "core.excludesFile", join(worktree, ".git-info-exclude"));
    await writeFile(join(worktree, ".git-info-exclude"), ".lervo/data/\n.git-info-exclude\n");
    await mkdir(join(worktree, ".lervo/data"), { recursive: true });
    await writeFile(join(worktree, ".lervo/data/events.sqlite"), "");
    await mkdir(join(worktree, ".lervo/state"), { recursive: true });
    await writeFile(join(worktree, ".lervo/state/current.json"), "{}\n");
    git(worktree, "add", "README.md");
    const staged = git(worktree, "diff", "--cached", "--name-only");

    // A copy from long ago, which keeping a new one prunes.
    const old = execFileSync(
      "git",
      ["-C", root, "commit-tree", git(root, "rev-parse", "HEAD^{tree}"), "-m", "old"],
      { encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" } },
    ).trim();
    git(root, "update-ref", `${RETIRED_CHANGES_PREFIX}wsp_old`, old);

    const kept = await effects.keepChanges(root, worktree, "wsp_a");
    const ref = kept.ref;
    expect(git(root, "for-each-ref", "--format=%(refname)", RETIRED_CHANGES_PREFIX)).toBe(ref);
    expect(git(root, "ls-tree", "-r", "--name-only", ref)).toBe("README.md\nnew.txt");
    expect(ref).toBe(`${RETIRED_CHANGES_PREFIX}wsp_a`);
    // The worktree's own index is untouched.
    expect(git(worktree, "diff", "--cached", "--name-only")).toBe(staged);
    expect(git(root, "show", `${ref}:README.md`)).toBe("changed");
    expect(git(root, "show", `${ref}:new.txt`)).toBe("untracked");
    expect(git(root, "rev-parse", `${ref}^`)).toBe(git(worktree, "rev-parse", "HEAD"));

    await effects.removeWorktree(root, worktree, true);
    expect(git(root, "worktree", "list")).not.toContain("repo-wt");
    // The copy outlives the worktree, and its restore command brings the changes back there.
    execFileSync("sh", ["-c", kept.restore]);
    expect(await readFile(join(worktree, "new.txt"), "utf8")).toBe("untracked\n");
    expect(await readFile(join(worktree, "README.md"), "utf8")).toBe("changed\n");
  });
});

describe("nested repositories in a workspace removed with its changes", () => {
  it("refuse an embedded repository, whose objects a copy cannot hold", async () => {
    const { root, worktree } = await repository();
    const nested = join(worktree, "vendor/lib");
    execFileSync("git", ["init", "-q", "-b", "main", nested]);
    await writeFile(join(nested, "a.txt"), "unpushed\n");
    git(nested, "add", ".");
    git(
      nested,
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=T",
      "commit",
      "-q",
      "-m",
      "x",
    );
    const effects = hostedWorkspaceRetireEffects();
    const refused = await effects.keepChanges(root, worktree, "wsp_a").catch((error) => error);
    expect(refused).toBeInstanceOf(NestedRepositoryChanges);
    expect((refused as NestedRepositoryChanges).paths).toEqual(["vendor/lib"]);
    expect(git(root, "for-each-ref", RETIRED_CHANGES_PREFIX)).toBe("");
  });

  it("refuse a submodule with uncommitted changes, and keep one that is clean", async () => {
    const { root, worktree } = await repository();
    const library = join(root, "..", "library");
    execFileSync("git", ["init", "-q", "-b", "main", library]);
    await writeFile(join(library, "a.txt"), "one\n");
    git(library, "add", ".");
    git(
      library,
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=T",
      "commit",
      "-q",
      "-m",
      "x",
    );
    const file = ["-c", "protocol.file.allow=always"];
    git(worktree, ...file, "submodule", "add", "-q", library, "lib");
    git(worktree, "commit", "-q", "-m", "add lib");
    const effects = hostedWorkspaceRetireEffects();
    await writeFile(join(worktree, "note.txt"), "mine\n");
    await expect(effects.keepChanges(root, worktree, "wsp_clean")).resolves.toMatchObject({
      ref: `${RETIRED_CHANGES_PREFIX}wsp_clean`,
    });
    await writeFile(join(worktree, "lib/a.txt"), "edited\n");
    const refused = await effects.keepChanges(root, worktree, "wsp_a").catch((error) => error);
    expect((refused as NestedRepositoryChanges).paths).toEqual(["lib"]);
  });
});

describe("the copies retiring keeps", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-11-27T12:00:00Z");

  it("drop any older than 14 days and all but the newest kept", () => {
    const copies = Array.from({ length: RETIRED_CHANGES_KEPT + 2 }, (_, rank) => ({
      ref: `${RETIRED_CHANGES_PREFIX}wsp_${rank}`,
      committedAtMs: now.getTime() - rank * 60_000,
    }));
    expect(expiredRetiredChanges(copies, now)).toEqual([
      `${RETIRED_CHANGES_PREFIX}wsp_${RETIRED_CHANGES_KEPT}`,
      `${RETIRED_CHANGES_PREFIX}wsp_${RETIRED_CHANGES_KEPT + 1}`,
    ]);
    expect(
      expiredRetiredChanges(
        [
          { ref: "a", committedAtMs: now.getTime() - 13 * day },
          { ref: "b", committedAtMs: now.getTime() - 15 * day },
        ],
        now,
      ),
    ).toEqual(["b"]);
  });

  it("never drop the copy just written, even when the clock or the order says so", () => {
    const copies = Array.from({ length: RETIRED_CHANGES_KEPT + 1 }, (_, rank) => ({
      ref: `${RETIRED_CHANGES_PREFIX}wsp_${rank}`,
      committedAtMs: now.getTime() - 15 * day * (rank === RETIRED_CHANGES_KEPT ? 1 : 0),
    }));
    const written = `${RETIRED_CHANGES_PREFIX}wsp_${RETIRED_CHANGES_KEPT}`;
    expect(expiredRetiredChanges(copies, now, written)).toEqual([
      `${RETIRED_CHANGES_PREFIX}wsp_${RETIRED_CHANGES_KEPT - 1}`,
    ]);
  });
});
