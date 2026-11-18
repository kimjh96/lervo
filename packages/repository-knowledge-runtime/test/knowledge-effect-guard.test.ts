import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyCommittedKnowledgeEffect,
  knowledgeEffectPreflight,
  knowledgeEffectUserPaths,
} from "../src/knowledge-effect-guard.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const environment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Owner",
  GIT_AUTHOR_EMAIL: "owner@example.invalid",
  GIT_COMMITTER_NAME: "Owner",
  GIT_COMMITTER_EMAIL: "owner@example.invalid",
};

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { env: environment, encoding: "utf8" });
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-effect-guard-"));
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  await writeFile(resolve(root, "NOTE.md"), "# Note\n\nThe owner's words.\n");
  await writeFile(resolve(root, "README.md"), "# Readme\n\nSee NOTE.md.\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "start"]);
  return root;
}

const notice = {
  effect: "repository_layout" as const,
  planId: "klayout_fixture",
  reason: "moved 1 document",
  crossCheck: "fixture reviewer agreed",
};

describe("undoable knowledge effects (ADR-0561)", () => {
  it("counts only user paths and holds an effect over uncommitted user work", async () => {
    const root = await repository();
    expect(
      knowledgeEffectUserPaths(["NOTE.md", ".lervo/knowledge/x.yaml", "docs/knowledge/a.md"]),
    ).toEqual(["NOTE.md"]);
    expect(await knowledgeEffectPreflight(root, ["NOTE.md", "docs/notes/NOTE.md"])).toBeNull();
    // An unsaved owner edit would enter Lervo's commit and be lost by its undo.
    await writeFile(resolve(root, "NOTE.md"), "# Note\n\nAn unsaved edit.\n");
    await writeFile(resolve(root, "DRAFT.md"), "# Draft\n");
    expect(await knowledgeEffectPreflight(root, ["NOTE.md", "DRAFT.md", "README.md"])).toEqual({
      reason: "paths_uncommitted",
      paths: ["DRAFT.md", "NOTE.md"].sort(),
    });
    // Lervo's own state never holds an effect.
    await mkdir(resolve(root, ".lervo"), { recursive: true });
    await writeFile(resolve(root, ".lervo/generated.json"), "{}\n");
    expect(await knowledgeEffectPreflight(root, ["README.md", ".lervo/generated.json"])).toBeNull();
  });

  it("refuses an effect that cannot land as its own commit", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-effect-guard-plain-"));
    roots.push(root);
    expect(await knowledgeEffectPreflight(root, ["NOTE.md"])).toMatchObject({
      reason: "commit_unavailable",
    });
  });

  it("commits an applied effect, and restores every path when the commit does not land", async () => {
    const root = await repository();
    const move = async () => {
      await mkdir(resolve(root, "docs/notes"), { recursive: true });
      await writeFile(resolve(root, "docs/notes/NOTE.md"), "# Note\n\nThe owner's words.\n");
      await rm(resolve(root, "NOTE.md"));
      await writeFile(resolve(root, "README.md"), "# Readme\n\nSee docs/notes/NOTE.md.\n");
      return "moved";
    };
    const paths = ["NOTE.md", "docs/notes/NOTE.md", "README.md"];
    const applied = await applyCommittedKnowledgeEffect({
      repositoryRoot: root,
      paths,
      notice,
      apply: move,
    });
    expect(applied.receipt).toBe("moved");
    const { commit } = applied;
    if (commit.status !== "committed") throw new Error("The effect did not land as a commit.");
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(commit.after);
    expect(git(root, ["log", "-1", "--format=%(trailers:key=Lervo-Effect,valueonly)"]).trim()).toBe(
      "repository_layout",
    );

    // A commit hook that refuses makes the commit fail; nothing may stay applied without it.
    git(root, ["reset", "-q", "--hard", commit.before]);
    const hooks = resolve(root, ".git", "hooks");
    await mkdir(hooks, { recursive: true });
    await writeFile(resolve(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
    await chmod(resolve(hooks, "pre-commit"), 0o755);
    await expect(
      applyCommittedKnowledgeEffect({ repositoryRoot: root, paths, notice, apply: move }),
    ).rejects.toMatchObject({ code: "knowledge_effect_commit_failed" });
    expect(await readFile(resolve(root, "NOTE.md"), "utf8")).toBe("# Note\n\nThe owner's words.\n");
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe("# Readme\n\nSee NOTE.md.\n");
    await expect(readFile(resolve(root, "docs/notes/NOTE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("keeps an effect that leaves nothing for Git to commit", async () => {
    const root = await repository();
    const unchanged = await applyCommittedKnowledgeEffect({
      repositoryRoot: root,
      paths: ["NOTE.md"],
      notice,
      apply: async () => "unchanged",
    });
    expect(unchanged).toEqual({
      receipt: "unchanged",
      commit: { status: "not_committed", reason: "nothing_to_commit" },
    });
  });
});
