import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { insideRepository, workspacesHome } from "../src/workspaces-home.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("where hosted workspaces live", () => {
  it("is ~/.lervo/workspaces on every host, unless LERVO_WORKSPACES_HOME moves it", () => {
    expect(workspacesHome({})).toBe(resolve(homedir(), ".lervo", "workspaces"));
    expect(workspacesHome({ LERVO_WORKSPACES_HOME: "/data/workspaces" })).toBe("/data/workspaces");
  });

  it("refuses an override that is not a safe absolute path, never falling back", () => {
    for (const value of ["", "relative", "/data/\nother"]) {
      let code: string | undefined;
      try {
        workspacesHome({ LERVO_WORKSPACES_HOME: value });
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code, JSON.stringify(value)).toBe("workspace_home_invalid");
    }
  });

  it("knows a home inside a repository, even one not created yet", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-home-")));
    roots.push(base);
    const repository = join(base, "repo");
    execFileSync("git", ["init", "-q", repository]);
    expect(await insideRepository(join(repository, "workspaces", "app"))).toBe(true);
    expect(await insideRepository(join(base, "workspaces"))).toBe(false);
  });

  it("knows a git folder and a bare repository, whatever GIT_DIR says", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-home-")));
    roots.push(base);
    const repository = join(base, "repo");
    const bare = join(base, "bare.git");
    execFileSync("git", ["init", "-q", repository]);
    execFileSync("git", ["init", "-q", "--bare", bare]);
    expect(await insideRepository(join(repository, ".git", "workspaces"))).toBe(true);
    expect(await insideRepository(join(bare, "workspaces"))).toBe(true);
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = join(repository, ".git");
    try {
      expect(await insideRepository(join(base, "elsewhere"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  });
});
