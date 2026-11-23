import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/main.js";
import { listRepositories, listWorkspaces } from "../src/workspace-list-service.js";

const execute = promisify(execFile);
const roots: string[] = [];
const instruction = "Add a health check endpoint\nReturn 200 with the build version.";

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

function io(cwd: string, stdin = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd,
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
      stdin: async () => stdin,
    },
  };
}

/** A registered Lervo repository whose project manifest is committed unless `uncommitted`. */
async function fixture(options: { uncommitted?: boolean } = {}) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-workspace-start-")));
  roots.push(root);
  const repository = resolve(root, "app");
  const state = resolve(root, "state");
  const bin = resolve(root, "bin");
  await mkdir(repository);
  await mkdir(bin);
  await writeFile(resolve(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
  await git(repository, "init", "--initial-branch", "main");
  await git(repository, "config", "user.email", "lervo-test@example.invalid");
  await git(repository, "config", "user.name", "Lervo Test");
  await writeFile(resolve(repository, "README.md"), "app\n");
  expect(await runCli(["init", "--root", repository, "--name", "app"], io(root).io)).toBe(0);
  if (!options.uncommitted) await git(repository, "add", "-A");
  else await git(repository, "add", "README.md");
  await git(repository, "commit", "-m", "base");
  const registered = io(root);
  expect(
    await runCli(
      [
        "repository",
        "register",
        "--root",
        repository,
        "--registry",
        resolve(state, "repositories.json"),
        "--write",
        "--json",
      ],
      registered.io,
    ),
  ).toBe(0);
  const { registration } = JSON.parse(registered.stdout.join("")) as {
    registration: { projectId: string };
  };
  return {
    root,
    repository,
    state,
    claude: resolve(bin, "claude"),
    projectId: registration.projectId,
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lervo workspace start and open", () => {
  it("creates the worktree, branch, and workstream, and returns the hosted launch", async () => {
    const app = await fixture();
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
      started.stdout.join("") + started.stderr.join(""),
    ).toBe(0);
    const result = JSON.parse(started.stdout.join("")) as {
      workspaceId: string;
      workstreamId: string;
      branch: string;
      sessionId: string;
      launch: {
        program: string;
        arguments: string[];
        workingDirectory: string;
        initialInput: string;
      };
    };
    expect(result.branch).toMatch(/^lervo\/add-a-health-check-endpoint-[a-f0-9]{6}$/u);
    expect(result.launch.program).toBe(app.claude);
    expect(result.launch.arguments).toEqual(
      expect.arrayContaining(["--session-id", result.sessionId]),
    );
    expect(result.launch.initialInput).toBe(instruction);
    const worktree = result.launch.workingDirectory;
    expect(worktree).toBe(resolve(app.root, "app-wt", result.branch.slice("lervo/".length)));
    expect(await git(worktree, "branch", "--show-current")).toBe(result.branch);
    const current = JSON.parse(
      await readFile(resolve(worktree, ".lervo/state/workstreams/current.json"), "utf8"),
    ) as { workstreamId: string; title: string };
    expect(current).toMatchObject({
      workstreamId: result.workstreamId,
      title: "Add a health check endpoint",
    });
    const records = await readFile(resolve(app.state, "hosted-launches.json"), "utf8");
    expect(records).toContain(result.sessionId);
    expect(records).not.toContain("build version");
    expect(records).not.toContain(app.root);

    expect((await listRepositories()).repositories).toEqual([
      { projectId: app.projectId, name: "app" },
    ]);
    expect((await listWorkspaces()).workspaces).toEqual([
      expect.objectContaining({
        workspaceId: result.workspaceId,
        repositoryName: "app",
        branch: result.branch,
        title: "Add a health check endpoint",
        conversationModes: ["native", "cli"],
        sessionId: result.sessionId,
      }),
    ]);

    const opened = io(app.root);
    expect(
      await runCli(
        ["workspace", "open", "--workspace", result.workspaceId, "--mode", "cli", "--json"],
        opened.io,
      ),
    ).toBe(0);
    const reopened = JSON.parse(opened.stdout.join("")) as {
      resumed: boolean;
      launch: { arguments: string[]; workingDirectory: string; mode: string };
    };
    expect(reopened).toMatchObject({
      resumed: true,
      launch: {
        arguments: ["--resume", result.sessionId],
        workingDirectory: worktree,
        mode: "cli",
      },
    });
  });

  it("removes the worktree and branch when the workstream stage fails", async () => {
    const app = await fixture({ uncommitted: true });
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
    ).toBe(1);
    const failure = JSON.parse(started.stdout.join("")) as {
      error: { code: string; stage: string; rolledBack: boolean };
    };
    expect(failure.error).toMatchObject({
      code: "workspace_start_failed",
      stage: "workstream",
      rolledBack: true,
    });
    expect(await git(app.repository, "branch", "--list", "lervo/*")).toBe("");
    expect((await git(app.repository, "worktree", "list")).split("\n")).toHaveLength(1);
  });

  it("reports a missing provider CLI without changing anything", async () => {
    const app = await fixture();
    vi.stubEnv("PATH", "/nonexistent");
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
    ).toBe(1);
    expect(JSON.parse(started.stdout.join(""))).toMatchObject({
      error: { code: "provider_cli_unavailable" },
    });
    vi.stubEnv("PATH", process.env.PATH ?? "");
  });
});
