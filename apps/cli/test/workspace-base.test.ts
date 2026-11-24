import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseWorkspaceBase,
  gitWorkspaceBase,
  type LocalCommit,
  type WorkspaceBaseGit,
} from "../src/workspace-base.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const effect = (commit: string): LocalCommit => ({
  commit,
  authorEmail: "knowledge@lervo.invalid",
  effect: true,
});

function fakeGit(overrides: Partial<WorkspaceBaseGit> = {}): WorkspaceBaseGit {
  return {
    defaultBranch: async () => "main",
    commitOf: async (ref) => (ref === "main" ? "local" : "upstream-tip"),
    upstreamOf: async () => "origin/main",
    fetch: async () => true,
    commitsBetween: async () => [],
    carriedBy: async () => false,
    ...overrides,
  };
}

describe("choosing where a workspace starts", () => {
  it("starts from the fetched upstream tip with the effect commits upstream lacks", async () => {
    const base = await chooseWorkspaceBase(
      fakeGit({
        commitsBetween: async () => [
          effect("published"),
          { commit: "owner", authorEmail: "owner@example.invalid", effect: false },
          { commit: "spoofed", authorEmail: "owner@example.invalid", effect: true },
          effect("unpublished"),
        ],
        carriedBy: async (_, commit) => commit === "published",
      }),
    );
    expect(base).toEqual({
      commit: "upstream-tip",
      source: "upstream",
      upstream: "origin/main",
      replay: ["unpublished"],
      notice: null,
    });
  });

  it("falls back to the local tip with a notice when there is no upstream or no fetch", async () => {
    expect(await chooseWorkspaceBase(fakeGit({ upstreamOf: async () => null }))).toMatchObject({
      commit: "local",
      source: "local",
      notice: "no_upstream",
    });
    expect(await chooseWorkspaceBase(fakeGit({ fetch: async () => false }))).toMatchObject({
      commit: "local",
      source: "local",
      upstream: "origin/main",
      notice: "fetch_failed",
    });
  });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

async function commitFile(root: string, file: string, text: string, message: string[]) {
  await writeFile(join(root, file), text);
  git(root, "add", file);
  git(root, "commit", "-q", ...message.flatMap((line) => ["-m", line]));
}

/** An upstream, the owner's clone behind it with one Lervo effect commit, and a second clone. */
async function repositories() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-base-")));
  roots.push(base);
  const remote = join(base, "remote.git");
  const owner = join(base, "owner");
  const other = join(base, "other");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  for (const clone of [owner, other]) {
    execFileSync("git", ["clone", "-q", remote, clone], { stdio: "ignore" });
    git(clone, "config", "user.email", "test@example.invalid");
    git(clone, "config", "user.name", "Test");
  }
  await commitFile(other, "README.md", "hello\n", ["first"]);
  git(other, "push", "-q", "origin", "main");
  git(owner, "pull", "-q", "origin", "main");
  git(owner, "branch", "-q", "--set-upstream-to=origin/main", "main");
  git(owner, "config", "user.email", "knowledge@lervo.invalid");
  await commitFile(owner, "hooks.json", "{}\n", ["chore: refresh hooks", "Lervo-Effect: hooks"]);
  git(owner, "config", "user.email", "test@example.invalid");
  await commitFile(other, "feature.txt", "new\n", ["feature"]);
  git(other, "push", "-q", "origin", "main");
  return { remote, owner, other };
}

describe("the real Git reads of the workspace base", () => {
  it("fetch the upstream, replay the unpublished effect commit, and never move the owner's branch", async () => {
    const { owner } = await repositories();
    const before = git(owner, "rev-parse", "main");
    const effectCommit = before;
    const base = await chooseWorkspaceBase(gitWorkspaceBase(owner));
    expect(base.source).toBe("upstream");
    expect(base.upstream).toBe("origin/main");
    expect(base.commit).toBe(git(owner, "rev-parse", "origin/main"));
    expect(base.replay).toEqual([effectCommit]);
    expect(git(owner, "rev-parse", "main")).toBe(before);
  });

  it("skip an effect commit whose change upstream already carries", async () => {
    const { owner, other } = await repositories();
    await commitFile(other, "hooks.json", "{}\n", ["publish hooks"]);
    git(other, "push", "-q", "origin", "main");
    const base = await chooseWorkspaceBase(gitWorkspaceBase(owner));
    expect(base.replay).toEqual([]);
  });

  it("start from the local tip when the upstream cannot be fetched", async () => {
    const { owner } = await repositories();
    git(owner, "remote", "set-url", "origin", join(owner, "missing.git"));
    const base = await chooseWorkspaceBase(gitWorkspaceBase(owner));
    expect(base).toMatchObject({ source: "local", notice: "fetch_failed" });
    expect(base.commit).toBe(git(owner, "rev-parse", "main"));
  });
});
