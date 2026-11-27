// Two conversations whose coordination is active, in two worktrees of one registered repository
// whose writer selects event schema 16, for the claim handler's tests.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, vi } from "vitest";

import { registerAgent } from "@lervo/agent-workforce";
import { openProjectStorage, resolveRepositoryCoordinationHome } from "@lervo/project-storage";

import { COORDINATION_GATE_FILE } from "../src/coordination-gate.js";

import { runCli } from "../src/main.js";
import { startWorkspaceFromInstruction } from "../src/workspace-launch-service.js";

const execute = promisify(execFile);

export async function git(root: string, ...arguments_: string[]): Promise<string> {
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

/** Selects an event schema in a local-only repository, as `lervo upgrade` would. */
async function activateSchema(cwd: string, repository: string, version: number): Promise<void> {
  const observed = io(cwd);
  expect(await runCli(["event-contract", "evidence", "--root", repository], observed.io)).toBe(0);
  const evidence = observed.stdout.join("");
  const activate = [
    "event-contract",
    "activate",
    "--stdin",
    "--schema-version",
    String(version),
    "--root",
    repository,
  ];
  const planned = io(cwd, evidence);
  expect(await runCli([...activate, "--json"], planned.io), planned.stderr.join("")).toBe(0);
  const { planId } = JSON.parse(planned.stdout.join("")) as { planId: string };
  const applied = io(cwd, evidence);
  expect(
    await runCli([...activate, "--apply", planId, "--json"], applied.io),
    applied.stderr.join(""),
  ).toBe(0);
}

export interface StartedConversation {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly worktree: string;
  readonly leadAgentId: string;
}

export interface ClaimFixture {
  readonly root: string;
  readonly repository: string;
  readonly first: StartedConversation;
  readonly second: StartedConversation;
  /** Starts another conversation led by a new agent. */
  startConversation(title: string, displayName: string): Promise<StartedConversation>;
  cleanup(): Promise<void>;
}

/**
 * A registered repository at schema 16 with the coordination gate open, and two conversations,
 * "Log format" and "Retry budget", each led by its own agent. The base commit ignores `*.log`.
 */
export async function claimFixture(): Promise<ClaimFixture> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-claims-")));
  const repository = resolve(root, "app");
  const state = resolve(root, "state");
  const bin = resolve(root, "bin");
  await mkdir(repository);
  await mkdir(bin);
  await writeFile(resolve(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  vi.stubEnv("LERVO_WORKSPACES_HOME", resolve(root, "workspaces"));
  vi.stubEnv("LERVO_COORDINATION", "1");
  vi.stubEnv("CLAUDE_CONFIG_DIR", resolve(root, "claude"));
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
  await git(repository, "init", "--initial-branch", "main");
  await git(repository, "config", "user.email", "lervo-test@example.invalid");
  await git(repository, "config", "user.name", "Lervo Test");
  await mkdir(resolve(repository, "src"));
  await writeFile(resolve(repository, "README.md"), "app\n");
  await writeFile(resolve(repository, "src/a.ts"), "export const a = 1;\n");
  await writeFile(resolve(repository, ".gitignore"), "*.log\n");
  expect(await runCli(["init", "--root", repository, "--name", "app"], io(root).io)).toBe(0);
  await git(repository, "add", "-A");
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
  await activateSchema(root, repository, 16);
  const start = async (title: string, displayName: string): Promise<StartedConversation> => {
    const lead = await registerAgent({
      repositoryRoot: repository,
      roleId: "developer",
      displayName,
      origin: "team",
    });
    const started = await startWorkspaceFromInstruction({
      instruction: `${title}\nChange it.`,
      repository: registration.projectId,
      participants: [lead.agentId],
    });
    expect(started.coordination).toEqual({ status: "active" });
    return {
      workspaceId: started.workspaceId,
      sessionId: started.sessionId,
      worktree: await realpath(started.launch.workingDirectory),
      leadAgentId: lead.agentId,
    };
  };
  const first = await start("Log format", "Arin");
  const second = await start("Retry budget", "Ciel");
  return {
    root,
    repository,
    first,
    second,
    startConversation: start,
    async cleanup() {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** The types and payloads of the repository's events of `types`. */
export async function eventsOf(repository: string, ...types: string[]) {
  const storage = await openProjectStorage(repository);
  try {
    return storage.events
      .list()
      .filter((event) => types.includes(event.type))
      .map((event) => ({ type: event.type, payload: event.payload }));
  } finally {
    await storage.close();
  }
}

/** Opens the repository's coordination gate by its owner-only file, as a canary does. */
export async function openGateByFile(repository: string): Promise<string> {
  const home = await resolveRepositoryCoordinationHome(repository);
  const path = resolve(home.root, COORDINATION_GATE_FILE);
  await writeFile(path, "", { mode: 0o600 });
  return path;
}
