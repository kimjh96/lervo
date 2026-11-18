import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { planCrossCheck } from "./plan-cross-check-fixture.js";

const developer = {
  GIT_AUTHOR_NAME: "Developer",
  GIT_AUTHOR_EMAIL: "dev@example.invalid",
  GIT_COMMITTER_NAME: "Developer",
  GIT_COMMITTER_EMAIL: "dev@example.invalid",
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    env: { ...process.env, ...developer },
    encoding: "utf8",
  }).trim();
}

/** A committed repository whose layout plan moves ARCHITECTURE.md and rewrites README.md. */
async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-cross-checked-layout-"));
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  await writeFile(resolve(root, "README.md"), "# Example\n\nSee ARCHITECTURE.md.\n");
  await writeFile(resolve(root, "ARCHITECTURE.md"), "# Architecture\n\nRuntime design.\n");
  const messages: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (message: string) => messages.push(message),
    stderr: (message: string) => errors.push(message),
  };
  expect(await runCli(["init"], io)).toBe(0);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "chore: start"]);
  messages.length = 0;
  expect(await runCli(["migrate", "knowledge", "--json"], io), errors.join("")).toBe(0);
  const plan = JSON.parse(messages.join("")) as {
    planId: string;
    planKind: string;
    status: string;
    moves: Array<{ operationId: string; approvalHash: string }>;
  };
  expect(plan).toMatchObject({ planKind: "repository_layout", status: "review_required" });
  messages.length = 0;
  return { root, io, messages, errors, plan };
}

describe("cross-checked repository layout (ADR-0561)", () => {
  it("applies the layout after agreement, commits it, and reverts it with one command that holds", async () => {
    const { root, io, messages, errors, plan } = await repository();
    const crossCheck = planCrossCheck("agree");
    expect(
      await runCli(["migrate", "knowledge", "--apply", plan.planId], io, crossCheck.services),
      errors.join(""),
    ).toBe(0);
    // The cross-check saw the exact plan and every path it changes, wherever they sit.
    expect(crossCheck.checked).toHaveLength(1);
    expect(crossCheck.checked[0]!.paths).toEqual(
      expect.arrayContaining(["ARCHITECTURE.md", "docs/architecture/system.md", "README.md"]),
    );
    const output = messages.join("");
    expect(output).toContain("Cross-check: fixture no-capability session agreed.");
    const commit = git(root, ["rev-parse", "HEAD"]);
    expect(output).toContain(`Undo: lervo knowledge revert ${commit}`);
    expect(git(root, ["log", "-1", "--format=%ae%n%s%n%b"])).toContain(
      "knowledge@lervo.invalid\ndocs: apply the cross-checked repository layout",
    );
    expect(git(root, ["log", "-1", "--format=%(trailers:key=Lervo-Effect,valueonly)"])).toBe(
      "repository_layout",
    );
    await expect(access(resolve(root, "ARCHITECTURE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(root, "README.md"), "utf8")).toContain(
      "docs/architecture/system.md",
    );

    messages.length = 0;
    expect(await runCli(["knowledge", "revert", commit, "--json"], io), errors.join("")).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      effect: "repository_layout",
      revertedCommit: commit,
      heldMoves: 1,
      commit: expect.stringMatching(/^[a-f0-9]{40}$/u),
    });
    expect(await readFile(resolve(root, "ARCHITECTURE.md"), "utf8")).toContain("Runtime design.");
    expect(await readFile(resolve(root, "README.md"), "utf8")).toContain("See ARCHITECTURE.md.");
    expect(git(root, ["status", "--porcelain", "--", "ARCHITECTURE.md", "README.md"])).toBe("");
    // The revert holds: the next plan keeps the document in place instead of moving it again.
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const replanned = JSON.parse(messages.join("")) as {
      moves?: Array<{ fromPath: string }>;
      retainedDocuments?: Array<{ path: string; basis: string }>;
    };
    expect(replanned.moves ?? []).not.toContainEqual(
      expect.objectContaining({ fromPath: "ARCHITECTURE.md" }),
    );
  }, 30_000);

  it("changes nothing when the independent cross-check disagrees", async () => {
    const { root, io, messages, plan } = await repository();
    const head = git(root, ["rev-parse", "HEAD"]);
    const crossCheck = planCrossCheck("disagree");
    expect(
      await runCli(
        ["migrate", "knowledge", "--apply", plan.planId, "--json"],
        io,
        crossCheck.services,
      ),
    ).toBe(1);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      error: { code: "knowledge_cross_check_disagreed", planId: plan.planId },
    });
    expect(await readFile(resolve(root, "ARCHITECTURE.md"), "utf8")).toContain("Runtime design.");
    expect(git(root, ["rev-parse", "HEAD"])).toBe(head);
  }, 30_000);

  it("rejects the removed owner approval options with the undo command", async () => {
    const { io, errors, plan } = await repository();
    const move = plan.moves[0]!;
    for (const args of [
      ["--apply", plan.planId, "--approve-item", `${move.operationId}=${move.approvalHash}`],
      ["--accept-layout", "klaydec_0=sha256:0"],
      ["--decline-layout", "klaydec_0"],
    ]) {
      errors.length = 0;
      expect(await runCli(["migrate", "knowledge", ...args], io)).toBe(1);
      expect(errors.join("")).toContain("lervo knowledge revert <commit>");
    }
    for (const args of [
      ["knowledge", "normalize", "--candidate", "knorm_x", "--approve-item", "x=y"],
      ["knowledge", "structure", "delete", "README.md", "--approve-item", "x=y"],
      ["knowledge", "instruction", "bridge", "--provider", "claude", "--approve-item", "x=y"],
    ]) {
      errors.length = 0;
      expect(await runCli(args, io)).toBe(1);
      expect(errors.join("")).toContain("--approve-item was removed");
    }
  }, 30_000);
});
