import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkoutOnBaseBranch, repositoryBaseBranch } from "../src/checkout-base-branch.js";
import {
  DELEGATION_TRACKING_COMMIT_SUBJECT,
  keepConvergenceDelegationHostLocal,
  mirrorConvergenceDelegation,
  restoreMirroredConvergenceDelegation,
} from "../src/delegation-tracking.js";
import { knowledgeEffectPreflight } from "../src/knowledge-effect-guard.js";
import { planKnowledgePublicationRepair } from "../src/knowledge-publication-repair-plan.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Owner",
      GIT_AUTHOR_EMAIL: "owner@example.invalid",
      GIT_COMMITTER_NAME: "Owner",
      GIT_COMMITTER_EMAIL: "owner@example.invalid",
    },
  }).trim();
}

function repository(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "lervo-base-branch-"));
  roots.push(root);
  git(root, "init", "--quiet", "--initial-branch=main");
  for (const [path, content] of Object.entries({ "README.md": "# Repo\n", ...files })) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "initial");
  return root;
}

describe("ADR-0610 base branch", () => {
  it("is the remote default, else main or master, and only that branch may receive effects", async () => {
    const root = repository();
    expect(await repositoryBaseBranch(root)).toBe("main");
    expect(await checkoutOnBaseBranch(root)).toEqual({ onBase: true });

    git(root, "checkout", "--quiet", "-b", "feature/owner-work");
    expect(await checkoutOnBaseBranch(root)).toEqual({
      onBase: false,
      branch: "feature/owner-work",
      base: "main",
    });
    expect(await knowledgeEffectPreflight(root, ["docs/a.md"])).toEqual({
      reason: "commit_unavailable",
      detail: "not_on_base",
    });

    git(root, "checkout", "--quiet", "--detach");
    expect(await checkoutOnBaseBranch(root)).toMatchObject({ onBase: false, branch: null });

    git(root, "checkout", "--quiet", "-b", "trunk");
    git(root, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    expect(await repositoryBaseBranch(root)).toBe("trunk");
    expect(await checkoutOnBaseBranch(root)).toEqual({ onBase: true });
  });
});

describe("ADR-0610 host-local delegation", () => {
  const delegation = ".lervo/knowledge/convergence-delegation.json";

  it("untracks a tracked delegation in one commit that captures no other staged work", async () => {
    const root = repository({
      ".lervo/.gitignore": "data/\nstate/\n",
      [delegation]: '{"providers":["claude"]}\n',
    });
    writeFileSync(join(root, "notes.md"), "owner draft\n");
    git(root, "add", "notes.md");

    git(root, "checkout", "--quiet", "-b", "feature/owner-work");
    expect(await keepConvergenceDelegationHostLocal(root)).toBe("held");
    expect(git(root, "ls-files", delegation)).toBe(delegation);
    git(root, "checkout", "--quiet", "main");

    expect(await keepConvergenceDelegationHostLocal(root)).toBe("committed");
    expect(git(root, "log", "-1", "--format=%s")).toBe(DELEGATION_TRACKING_COMMIT_SUBJECT);
    expect(git(root, "show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual([
      "D\t.lervo/knowledge/convergence-delegation.json",
      "M\t.lervo/.gitignore",
    ]);
    expect(readFileSync(join(root, ".lervo/.gitignore"), "utf8")).toBe(
      "data/\nstate/\nknowledge/convergence-delegation.json\n",
    );
    expect(existsSync(join(root, delegation))).toBe(true);
    expect(git(root, "ls-files", delegation)).toBe("");
    expect(git(root, "status", "--porcelain")).toBe("A  notes.md");
    expect(await keepConvergenceDelegationHostLocal(root)).toBe("current");
  });

  // The v0.31.0 loop: in a fixed-roots scope the repair undid this commit's ignore line, and the
  // next resident cycle untracked the delegation again, 14 commits in flemo on 2026-11-22.
  it("is never undone by the publication repair, even in a fixed-roots scope", async () => {
    const root = repository({
      ".lervo/.gitignore": "data/\nstate/\n",
      [delegation]: '{"providers":["claude"]}\n',
    });
    const base = git(root, "rev-parse", "HEAD");
    expect(await keepConvergenceDelegationHostLocal(root)).toBe("committed");
    const unpublished = [
      {
        sha: git(root, "rev-parse", "HEAD"),
        subject: git(root, "log", "-1", "--format=%s"),
        body: git(root, "log", "-1", "--format=%b"),
        paths: git(root, "show", "--name-only", "--format=", "HEAD").split("\n"),
        committerDate: "0 +0000",
      },
    ];
    const scope = { source: "roots" as const, roots: ["docs/"] };
    const plan = await planKnowledgePublicationRepair({
      repositoryRoot: root,
      base,
      unpublished,
      scope,
    });
    expect(plan.targets).toEqual([]);
    // Control: the same paths in a convergence-output commit are outside this scope.
    const control = await planKnowledgePublicationRepair({
      repositoryRoot: root,
      base,
      unpublished: [{ ...unpublished[0]!, body: "Lervo convergence kco_x settled." }],
      scope,
    });
    expect(control.targets.map((target) => target.path)).toContain(".lervo/.gitignore");
  });

  it("restores the mirror once after a pull removed the untracked delegation", async () => {
    const root = repository({
      ".lervo/.gitignore": "data/\nstate/\n",
      [delegation]: '{"providers":["claude"]}\n',
    });
    const bytes = Buffer.from('{"providers":["claude"]}\n');
    await mirrorConvergenceDelegation(root, bytes, "sha256:mirror-test");
    expect(await keepConvergenceDelegationHostLocal(root)).toBe("committed");
    rmSync(join(root, delegation));
    expect(Buffer.from((await restoreMirroredConvergenceDelegation(root))!)).toEqual(bytes);
    expect(readFileSync(join(root, delegation))).toEqual(bytes);
    // A later removal by the owner stands.
    rmSync(join(root, delegation));
    expect(await restoreMirroredConvergenceDelegation(root)).toBeNull();
  });

  it("never restores a delegation Lervo did not untrack", async () => {
    const root = repository({
      ".lervo/.gitignore": "knowledge/convergence-delegation.json\n",
    });
    await mirrorConvergenceDelegation(root, Buffer.from("{}\n"), "sha256:never-tracked");
    expect(await restoreMirroredConvergenceDelegation(root)).toBeNull();
    mkdirSync(join(root, ".lervo/knowledge"), { recursive: true });
    writeFileSync(join(root, delegation), "{}\n");
    git(root, "add", "-f", delegation);
    git(root, "commit", "--quiet", "-m", "track");
    rmSync(join(root, delegation));
    expect(await restoreMirroredConvergenceDelegation(root)).toBeNull();
  });
});
