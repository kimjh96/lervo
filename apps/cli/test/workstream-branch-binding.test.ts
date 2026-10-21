import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { selectBranchWorkstream } from "../src/workstream-branch-selection.js";

const execute = promisify(execFile);
const roots: string[] = [];
const bindingsPath = ".lervo/state/workstreams/bindings.json";
const currentPath = ".lervo/state/workstreams/current.json";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", root, ...args])).stdout.trim();
}

async function gitRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-workstream-branches-"));
  roots.push(root);
  expect(
    await runCli(["init"], { cwd: root, stdout: () => undefined, stderr: () => undefined }),
  ).toBe(0);
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "config", "user.name", "Lervo Test");
  await writeFile(resolve(root, "README.md"), "# Branch fixture\n");
  await git(root, "add", "README.md");
  await git(root, "commit", "-q", "-m", "fixture");
  return root;
}

async function run(root: string, args: string[], stdin?: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    cwd: root,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    ...(stdin === undefined ? {} : { stdin: async () => stdin }),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

const agent = ["--actor", "agent", "--provider", "claude"];

function draft(title: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    status: "active",
    title,
    objective: `Continue ${title}.`,
    nextActions: [`Advance ${title}.`],
    blockers: [],
    notes: [],
    references: [],
  });
}

async function start(root: string, title: string): Promise<string> {
  const result = await run(
    root,
    ["workstream", "start", ...agent, "--stdin", "--apply-now", "--json"],
    draft(title),
  );
  expect(result.code, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { workstreamId: string }).workstreamId;
}

async function current(root: string): Promise<{ workstreamId: string; revision: number } | null> {
  const result = await run(root, ["workstream", "current", "--json"]);
  expect(result.code, result.stderr).toBe(0);
  return (
    JSON.parse(result.stdout) as { workstream: { workstreamId: string; revision: number } | null }
  ).workstream;
}

async function bindings(root: string) {
  return JSON.parse(await readFile(resolve(root, bindingsPath), "utf8")) as {
    defaultBranch: string;
    bindings: Record<string, string>;
  };
}

describe("branch-bound workstream selection", () => {
  it("keeps one workstream per branch and re-projects it when the branch is checked out", async () => {
    const root = await gitRepository();
    const repositoryWide = await start(root, "Repository program");
    expect(await bindings(root)).toEqual({
      schemaVersion: 1,
      defaultBranch: "main",
      bindings: { main: repositoryWide },
    });

    await git(root, "switch", "-q", "-c", "feature");
    expect(await current(root)).toBeNull();
    await expect(access(resolve(root, currentPath))).rejects.toThrow();
    const feature = await start(root, "Feature work");
    expect((await bindings(root)).bindings).toEqual({ main: repositoryWide, feature });

    await git(root, "switch", "-q", "main");
    expect(await current(root)).toMatchObject({ workstreamId: repositoryWide, revision: 1 });
    const update = await run(root, [
      "workstream",
      "update",
      ...agent,
      "--patch",
      JSON.stringify({ nextActions: ["Advance the program."] }),
      "--apply-now",
    ]);
    expect(update.code, update.stderr).toBe(0);
    const context = await run(root, ["workstream", "current", "--context"]);
    expect(context.stdout).toContain("Freshness: current.");

    await git(root, "switch", "-q", "feature");
    expect(await current(root)).toMatchObject({ workstreamId: feature, revision: 1 });
    expect((await run(root, ["workstream", "current", "--context"])).stdout).toContain(
      "Freshness: current.",
    );
    await git(root, "switch", "-q", "main");
    expect(await current(root)).toMatchObject({ workstreamId: repositoryWide, revision: 2 });
  }, 60_000);

  it("binds an existing single workstream to the default branch on first use", async () => {
    const root = await gitRepository();
    const repositoryWide = await start(root, "Repository program");
    await rm(resolve(root, bindingsPath));
    await git(root, "switch", "-q", "-c", "feature");

    expect(await current(root)).toBeNull();
    expect((await bindings(root)).bindings).toEqual({ main: repositoryWide });
  }, 60_000);

  it("leaves the projection unscoped on a detached HEAD", async () => {
    const root = await gitRepository();
    const repositoryWide = await start(root, "Repository program");
    await git(root, "switch", "-q", "--detach");

    expect(await current(root)).toMatchObject({ workstreamId: repositoryWide });
  }, 60_000);

  it("moves a branch to the successor of its settled workstream", async () => {
    const root = await gitRepository();
    const predecessor = await start(root, "Repository program");
    const successor = `wks_${"b".repeat(24)}`;

    const selection = await selectBranchWorkstream({
      root,
      projected: {
        workstreamId: successor,
        origin: {
          kind: "successor",
          predecessorWorkstreamId: predecessor,
          predecessorSnapshotContentHash: `sha256:${"c".repeat(64)}`,
        } as never,
      },
    });

    expect(selection).toMatchObject({ kind: "bound", branch: "main", workstreamId: successor });
    expect((await bindings(root)).bindings).toEqual({ main: successor });
  }, 60_000);
});
