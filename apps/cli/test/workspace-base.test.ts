import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseWorkspaceBase,
  gitWorkspaceBase,
  type Upstream,
  type WorkspaceBaseGit,
} from "../src/workspace-base.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const origin: Upstream = { remote: "origin", branch: "main" };

function fakeGit(overrides: Partial<WorkspaceBaseGit> = {}): WorkspaceBaseGit {
  return {
    defaultBranch: async () => "main",
    commitOf: async (ref) => (ref === "refs/heads/main" ? "local" : "upstream-tip"),
    upstreamOf: async () => origin,
    fetch: async () => undefined,
    unpublished: async () => [],
    ...overrides,
  };
}

describe("choosing where a workspace starts", () => {
  it("starts from the fetched upstream tip with every unpublished commit, in order", async () => {
    const base = await chooseWorkspaceBase(
      fakeGit({ unpublished: async () => ["change", "repair"] }),
      "fallback",
    );
    expect(base).toEqual({
      commit: "upstream-tip",
      source: "upstream",
      upstream: "origin/main",
      replay: ["change", "repair"],
      notice: null,
    });
  });

  it("starts from the fallback when the repository names no default branch", async () => {
    expect(
      await chooseWorkspaceBase(
        fakeGit({ defaultBranch: () => Promise.reject(new Error("none")) }),
        "fallback",
      ),
    ).toEqual({
      commit: "fallback",
      source: "local",
      upstream: null,
      replay: [],
      notice: "base_unresolved",
    });
  });

  it("falls back to the local tip when there is no upstream or any upstream step fails", async () => {
    expect(
      await chooseWorkspaceBase(fakeGit({ upstreamOf: async () => null }), "fallback"),
    ).toMatchObject({
      commit: "local",
      source: "local",
      notice: "no_upstream",
    });
    const failing = new Error("failed");
    for (const overrides of [
      { fetch: () => Promise.reject(failing) },
      { unpublished: () => Promise.reject(failing) },
    ])
      expect(await chooseWorkspaceBase(fakeGit(overrides), "fallback")).toMatchObject({
        commit: "local",
        source: "local",
        upstream: "origin/main",
        notice: "fetch_failed",
      });
  });

  it("replays nothing, with a notice, when the resident's state cannot be read", async () => {
    expect(
      await chooseWorkspaceBase(fakeGit({ unpublished: async () => null }), "fallback"),
    ).toEqual({
      commit: "upstream-tip",
      source: "upstream",
      upstream: "origin/main",
      replay: [],
      notice: "knowledge_state_unreadable",
    });
  });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** The `Lervo Knowledge` identity, as author and committer, or as author only. */
const knowledge = {
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};
const authorOnly = {
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
};

async function commitFile(
  root: string,
  file: string,
  text: string,
  message: string,
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
  git(root, "add", file);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", message], {
    env: { ...process.env, ...env },
  });
  return git(root, "rev-parse", "HEAD");
}

/** An upstream, the owner's clone behind it, and a second clone that pushes to it. */
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
  await commitFile(other, "README.md", "hello\n", "first");
  git(other, "push", "-q", "origin", "main");
  git(owner, "pull", "-q", "origin", "main");
  git(owner, "branch", "-q", "--set-upstream-to=origin/main", "main");
  return { remote, owner, other };
}

async function advanceUpstream(other: string) {
  await commitFile(other, `feature-${Date.now()}.txt`, "new\n", "feature");
  git(other, "push", "-q", "origin", "main");
}

describe("the real Git reads of the workspace base", () => {
  it("fetch the upstream, replay an unpublished knowledge commit, and never move the owner's branch", async () => {
    const { owner, other } = await repositories();
    // Most knowledge commits carry no trailer, such as an applied owner rule.
    const rule = await commitFile(
      owner,
      "docs/rule.md",
      "rule\n",
      "apply a reviewed owner rule",
      knowledge,
    );
    await advanceUpstream(other);
    const base = await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback");
    expect(base).toMatchObject({ source: "upstream", upstream: "origin/main", notice: null });
    expect(base.commit).toBe(git(owner, "rev-parse", "refs/remotes/origin/main"));
    expect(base.replay).toEqual([rule]);
    expect(git(owner, "rev-parse", "main")).toBe(rule);
  });

  it("replay non-ASCII paths and mode-only changes, which upstream does not hold", async () => {
    const { owner, other } = await repositories();
    const named = await commitFile(owner, "docs/한글.md", "내용\n", "add a page", knowledge);
    await chmod(join(owner, "README.md"), 0o755);
    git(owner, "add", "README.md");
    execFileSync("git", ["-C", owner, "commit", "-q", "-m", "make it runnable"], {
      env: { ...process.env, ...knowledge },
    });
    const mode = git(owner, "rev-parse", "HEAD");
    await advanceUpstream(other);
    expect((await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).replay).toEqual([
      named,
      mode,
    ]);
  });

  it("skip developer work and an author-only Lervo commit, and keep a later repair", async () => {
    const { owner, other } = await repositories();
    await commitFile(owner, "work.txt", "mine\n", "my work");
    await commitFile(owner, "squashed.md", "x\n", "rebased into Lervo's name", authorOnly);
    const change = await commitFile(owner, "tool.json", "{}\n", "apply knowledge", knowledge);
    // The resident's repair restores a tool-owned path; dropping it would bring the path back.
    git(owner, "rm", "-q", "tool.json");
    execFileSync("git", ["-C", owner, "commit", "-q", "-m", "restore paths"], {
      env: { ...process.env, ...knowledge },
    });
    const repair = git(owner, "rev-parse", "HEAD");
    await advanceUpstream(other);
    expect((await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).replay).toEqual([
      change,
      repair,
    ]);
  });

  it("count only the default branch's commits, whatever the owner has checked out", async () => {
    const { owner, other } = await repositories();
    const onMain = await commitFile(owner, "docs/main.md", "m\n", "apply knowledge", knowledge);
    git(owner, "switch", "-q", "-c", "feat");
    await commitFile(owner, "docs/feat.md", "f\n", "apply knowledge on feat", knowledge);
    await advanceUpstream(other);
    expect((await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).replay).toEqual([
      onMain,
    ]);
  });

  it("never take a feature branch for the default", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-feat-")));
    roots.push(base);
    const remote = join(base, "remote.git");
    const owner = join(base, "owner");
    execFileSync("git", ["init", "-q", "--bare", "-b", "trunk", remote]);
    execFileSync("git", ["init", "-q", "-b", "trunk", owner]);
    git(owner, "config", "user.email", "test@example.invalid");
    git(owner, "config", "user.name", "Test");
    git(owner, "remote", "add", "origin", remote);
    await commitFile(owner, "README.md", "hello\n", "first");
    git(owner, "push", "-q", "-u", "origin", "trunk");
    git(owner, "switch", "-q", "-c", "feat");
    await commitFile(owner, "work.txt", "wip\n", "work in progress");
    expect(await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).toMatchObject({
      upstream: "origin/trunk",
      commit: git(owner, "rev-parse", "trunk"),
    });
    git(owner, "push", "-q", "-u", "origin", "feat");
    expect(await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).toEqual({
      commit: "fallback",
      source: "local",
      upstream: null,
      replay: [],
      notice: "base_unresolved",
    });
  });

  it("find a default branch other than main without the remote's HEAD", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-trunk-")));
    roots.push(base);
    const remote = join(base, "remote.git");
    const owner = join(base, "owner");
    execFileSync("git", ["init", "-q", "--bare", "-b", "trunk", remote]);
    execFileSync("git", ["init", "-q", "-b", "trunk", owner]);
    git(owner, "config", "user.email", "test@example.invalid");
    git(owner, "config", "user.name", "Test");
    git(owner, "remote", "add", "origin", remote);
    await commitFile(owner, "README.md", "hello\n", "first");
    git(owner, "push", "-q", "-u", "origin", "trunk");
    expect(await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).toMatchObject({
      source: "upstream",
      upstream: "origin/trunk",
      commit: git(owner, "rev-parse", "trunk"),
      notice: null,
    });
  });

  it("skip a superseded commit, and replay nothing when the resident's state is unreadable", async () => {
    const { owner, other } = await repositories();
    const superseded = await commitFile(owner, "docs/a.md", "a\n", "apply knowledge", knowledge);
    await advanceUpstream(other);
    const state = join(owner, ".lervo/state/knowledge/knowledge-publication.json");
    await mkdir(dirname(state), { recursive: true });
    await writeFile(
      state,
      JSON.stringify({ schemaVersion: 1, status: "superseded", supersededCommits: [superseded] }),
    );
    expect((await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).replay).toEqual([]);
    // After publications, a missing history cache cannot say what a person declined.
    await writeFile(
      state,
      JSON.stringify({
        schemaVersion: 1,
        status: "merged",
        pullRequestNumber: 12,
        pullRequestUrl: null,
        publishedHead: null,
        commitCount: 1,
        updatedAt: "2026-11-25T00:00:00.000Z",
        failure: null,
      }),
    );
    expect(await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).toMatchObject({
      replay: [],
      notice: "knowledge_state_unreadable",
    });
    await writeFile(state, "{ not json");
    expect(await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).toMatchObject({
      source: "upstream",
      replay: [],
      notice: "knowledge_state_unreadable",
    });
  });

  it("fetch the upstream's own ref, whatever the fetch refspec or a shadowing branch says", async () => {
    const { owner, other } = await repositories();
    git(owner, "config", "--unset-all", "remote.origin.fetch");
    git(owner, "branch", "-q", "origin/main", "main");
    await advanceUpstream(other);
    const base = await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback");
    expect(base.source).toBe("upstream");
    expect(base.commit).toBe(git(other, "rev-parse", "main"));
  });

  it("start from the local tip when the upstream cannot be fetched or is local", async () => {
    const { owner } = await repositories();
    git(owner, "remote", "set-url", "origin", join(owner, "missing.git"));
    const failed = await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback");
    expect(failed).toMatchObject({ source: "local", notice: "fetch_failed" });
    expect(failed.commit).toBe(git(owner, "rev-parse", "main"));
    git(owner, "config", "branch.main.remote", ".");
    expect(await chooseWorkspaceBase(gitWorkspaceBase(owner), "fallback")).toMatchObject({
      source: "local",
      notice: "no_upstream",
    });
  });
});
