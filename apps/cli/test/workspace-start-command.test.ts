import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAgent } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { runCli } from "../src/main.js";
import { runCoreLinkWorkspaceCommand } from "../src/core-link-workspace-commands.js";
import { listRepositories, listWorkspaces } from "../src/workspace-list-service.js";
import { openWorkspace, startWorkspaceFromInstruction } from "../src/workspace-launch-service.js";
import { joinWorkspaceRoom, routeRoomTurn } from "../src/workspace-room.js";
import { pendingSendsOf, pendingSendsPath } from "../src/room-sends.js";
import { pendingStartsOf, pendingStartsPath } from "../src/room-starts.js";
import { sendToConversation } from "../src/workspace-agent-send.js";
import { startAgentConversation } from "../src/workspace-agent-start.js";
import { roomBlock } from "../src/room-context.js";

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
async function fixture(options: { uncommitted?: boolean; noCommit?: boolean } = {}) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-workspace-start-")));
  roots.push(root);
  const repository = resolve(root, "app");
  const state = resolve(root, "state");
  const bin = resolve(root, "bin");
  await mkdir(repository);
  await mkdir(bin);
  await writeFile(resolve(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  vi.stubEnv("LERVO_WORKSPACES_HOME", resolve(root, "workspaces"));
  // The user's own Claude settings must not decide which hooks a hosted launch adds here.
  vi.stubEnv("CLAUDE_CONFIG_DIR", resolve(root, "claude"));
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
  await git(repository, "init", "--initial-branch", "main");
  await git(repository, "config", "user.email", "lervo-test@example.invalid");
  await git(repository, "config", "user.name", "Lervo Test");
  await writeFile(resolve(repository, "README.md"), "app\n");
  expect(await runCli(["init", "--root", repository, "--name", "app"], io(root).io)).toBe(0);
  if (!options.uncommitted) await git(repository, "add", "-A");
  else await git(repository, "add", "README.md");
  if (!options.noCommit) await git(repository, "commit", "-m", "base");
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

/** Selects event schema 10 in a local-only repository, as `lervo upgrade` would. */
async function activateSchema10(cwd: string, repository: string): Promise<void> {
  const observed = io(cwd);
  expect(await runCli(["event-contract", "evidence", "--root", repository], observed.io)).toBe(0);
  const evidence = observed.stdout.join("");
  const activate = [
    "event-contract",
    "activate",
    "--stdin",
    "--schema-version",
    "10",
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

async function eventTypes(repository: string): Promise<string[]> {
  const storage = await openProjectStorage(repository);
  try {
    return storage.events.list().map((event) => event.type);
  } finally {
    await storage.close();
  }
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
    // Workspaces live apart from the project, never in a folder beside it.
    expect(worktree).toBe(
      resolve(app.root, "workspaces", "app", result.branch.slice("lervo/".length)),
    );
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

    // Without a profile, the display name is the manifest's name and there is no mark.
    expect((await listRepositories()).repositories).toEqual([
      {
        projectId: app.projectId,
        name: "app",
        displayName: "app",
        mark: null,
        root: app.repository,
      },
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
        arguments: [
          "--resume",
          result.sessionId,
          "--settings",
          resolve(app.state, "hosted-settings", `${result.sessionId}.json`),
        ],
        workingDirectory: worktree,
        mode: "cli",
      },
    });
  });

  it("keeps a reopened conversation's place in the list", async () => {
    const app = await fixture();
    const start = async (text: string) => {
      const started = io(app.root, text);
      expect(
        await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
        started.stdout.join("") + started.stderr.join(""),
      ).toBe(0);
      return (JSON.parse(started.stdout.join("")) as { workspaceId: string }).workspaceId;
    };
    const first = await start("Fix the login form");
    const second = await start("Tidy the footer");
    const order = async () => (await listWorkspaces()).workspaces.map((item) => item.workspaceId);
    expect(await order()).toEqual([second, first]);
    // Opening the older conversation resumes its session, which is no activity.
    await openWorkspace(first);
    expect(await order()).toEqual([second, first]);
    const { records } = JSON.parse(
      await readFile(resolve(app.state, "hosted-launches.json"), "utf8"),
    ) as { records: { workspaceId: string; preparedAt: string; listedAt?: string }[] };
    const [started, reopened] = records.filter((record) => record.workspaceId === first);
    expect(reopened?.listedAt).toBe(started?.preparedAt);
    expect(reopened!.preparedAt > started!.preparedAt).toBe(true);
  });

  it("lists the owner's title over the agent's, and a pinned conversation first", async () => {
    const app = await fixture();
    const start = async (text: string) => {
      const started = io(app.root, text);
      expect(
        await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
      ).toBe(0);
      return (JSON.parse(started.stdout.join("")) as { workspaceId: string }).workspaceId;
    };
    const first = await start("Fix the login form");
    const second = await start("Tidy the footer");
    await runCoreLinkWorkspaceCommand("workspace.rename", first, { title: "Login release" });
    await runCoreLinkWorkspaceCommand("workspace.pin", first, { pinned: true });
    // The agent updates its workstream title; the owner's title stays.
    const { launch } = await openWorkspace(first);
    const current = resolve(launch.workingDirectory, ".lervo/state/workstreams/current.json");
    const workstream = JSON.parse(await readFile(current, "utf8")) as Record<string, unknown>;
    await writeFile(current, JSON.stringify({ ...workstream, title: "Agent's own title" }));
    const listed = (await listWorkspaces()).workspaces;
    expect(
      listed.map((item) => [item.workspaceId, item.title, item.pinnedAt !== undefined]),
    ).toEqual([
      [first, "Login release", true],
      [second, "Tidy the footer", false],
    ]);
    // Unpinned, the older conversation returns to its place by activity.
    await runCoreLinkWorkspaceCommand("workspace.pin", first, { pinned: false });
    expect((await listWorkspaces()).workspaces.map((item) => item.workspaceId)).toEqual([
      second,
      first,
    ]);
  });

  it("refuses a repository with no commit yet under its own code", async () => {
    const app = await fixture({ noCommit: true });
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
    ).toBe(1);
    const failure = JSON.parse(started.stdout.join("")) as { error: { code: string } };
    expect(failure.error.code).toBe("repository_has_no_commit");
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

  it("refuses a home whose folder for the repository is a checkout, without changing anything", async () => {
    const app = await fixture();
    // The home itself is no repository, but <home>/app is the project's own checkout.
    vi.stubEnv("LERVO_WORKSPACES_HOME", app.root);
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
    ).toBe(1);
    const failure = JSON.parse(started.stdout.join("")) as { error: { code: string } };
    expect(failure.error.code).toBe("workspace_home_invalid");
    expect(await git(app.repository, "branch", "--list", "lervo/*")).toBe("");
  });

  it("refuses an invalid LERVO_WORKSPACES_HOME without changing anything", async () => {
    const app = await fixture();
    vi.stubEnv("LERVO_WORKSPACES_HOME", "relative/workspaces");
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
    ).toBe(1);
    const failure = JSON.parse(started.stdout.join("")) as { error: { code: string } };
    expect(failure.error.code).toBe("workspace_home_invalid");
    expect(await git(app.repository, "branch", "--list", "lervo/*")).toBe("");
  });

  it("refuses a workspaces home inside a repository without changing anything", async () => {
    const app = await fixture();
    vi.stubEnv("LERVO_WORKSPACES_HOME", resolve(app.repository, "workspaces"));
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
    ).toBe(1);
    const failure = JSON.parse(started.stdout.join("")) as { error: { code: string } };
    expect(failure.error.code).toBe("workspace_home_invalid");
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

  it("adds Lervo's session hooks without recording events below schema 10", async () => {
    const app = await fixture();
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
    ).toBe(0);
    const result = JSON.parse(started.stdout.join("")) as {
      sessionId: string;
      hostedEvents: string;
      launch: { arguments: string[] };
    };
    const settings = resolve(app.state, "hosted-settings", `${result.sessionId}.json`);
    expect(result.launch.arguments).toEqual(expect.arrayContaining(["--settings", settings]));
    expect((await stat(settings)).mode & 0o777).toBe(0o600);
    const hooks = JSON.parse(await readFile(settings, "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    // The fixture commits no project hooks, so Lervo's terminal hooks join for every event.
    expect(Object.keys(hooks.hooks)).toEqual([
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "Stop",
    ]);
    // The host launcher runs where the install has one, and the CLI's hook where it has none.
    expect(hooks.hooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toMatch(
      /^(?:lervo terminal hook|node '.*\/launcher\.mjs') --provider claude --contract 2$/u,
    );
    expect(hooks.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe(
      "lervo workspace hook --provider claude",
    );
    expect(result.hostedEvents).toBe("inactive");
    expect(await eventTypes(app.repository)).not.toContain("terminal.session.launch_prepared");
  });

  it("records a hosted session's launch, start, and end at schema 10", async () => {
    const app = await fixture();
    await activateSchema10(app.root, app.repository);
    const started = io(app.root, instruction);
    expect(
      await runCli(["workspace", "start", "--repository", app.projectId, "--json"], started.io),
      started.stderr.join(""),
    ).toBe(0);
    const result = JSON.parse(started.stdout.join("")) as {
      sessionId: string;
      hostedEvents: string;
    };
    expect(result.hostedEvents).toBe("recorded");
    for (const input of [
      { session_id: result.sessionId, hook_event_name: "SessionStart", source: "startup" },
      { session_id: result.sessionId, hook_event_name: "SessionEnd", reason: "other" },
      { session_id: "11111111-2222-4333-8444-555555555555", hook_event_name: "SessionStart" },
      { hook_event_name: "SessionEnd" },
    ]) {
      const hook = io(app.root, JSON.stringify(input));
      expect(await runCli(["workspace", "hook", "--provider", "claude"], hook.io)).toBe(0);
      // A SessionStart handler's output would reach the model's context.
      expect(hook.stdout).toEqual([]);
    }
    const types = await eventTypes(app.repository);
    expect(
      types.filter(
        (type) => type.startsWith("terminal.session.") || type.startsWith("application."),
      ),
    ).toEqual([
      "application.workspace.started",
      "terminal.session.launch_prepared",
      "terminal.session.launched",
      "terminal.session.ended",
    ]);
  });
});

describe("agents joining a conversation", () => {
  it("routes the owner's turn, gives a mentioned agent its own member workspace, and keeps the lead", async () => {
    const app = await fixture();
    const lead = await registerAgent({
      repositoryRoot: app.repository,
      roleId: "developer",
      origin: "team",
    });
    const researcher = await registerAgent({
      repositoryRoot: app.repository,
      roleId: "researcher",
      origin: "team",
    });
    const started = await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [lead.agentId],
    });
    const workspaceId = started.workspaceId;

    expect(await routeRoomTurn({ workspaceId, text: "Keep going." })).toEqual({
      agents: [lead.agentId],
    });
    expect(
      await routeRoomTurn({ workspaceId, text: `@${researcher.displayName} is it in seconds?` }),
    ).toEqual({ agents: [researcher.agentId] });

    const joined = await joinWorkspaceRoom({
      workspaceId,
      agentId: researcher.agentId,
      instruction: "Is the Retry-After header in seconds?",
    });
    expect(joined).toMatchObject({
      status: "joined",
      workspaceId,
      agentId: researcher.agentId,
      resumed: false,
    });
    // The member writes in a worktree of its own, never in the lead's (ADR-0661).
    expect(joined.launch.workingDirectory).not.toBe(started.launch.workingDirectory);
    expect(joined.launch.arguments).not.toContain("dontAsk");
    expect(joined.launch.environment.LERVO_AGENT_ID).toBe(researcher.agentId);
    expect(joined.launch.initialInput).toBe("Is the Retry-After header in seconds?");
    expect(
      (await git(app.repository, "worktree", "list")).includes(joined.launch.workingDirectory),
    ).toBe(true);

    const workspaces = (await listWorkspaces()).workspaces;
    // The member workspace never lists as a conversation of its own.
    expect(workspaces.map((workspace) => workspace.workspaceId)).toEqual([workspaceId]);
    expect(workspaces[0]).toMatchObject({
      sessionId: started.sessionId,
      agentId: lead.agentId,
      participants: [lead.agentId, researcher.agentId],
      sessions: [
        { agentId: lead.agentId, sessionId: started.sessionId, access: "write" },
        { agentId: researcher.agentId, sessionId: joined.sessionId, access: "write" },
      ],
    });

    // Each agent's session learns who it is, who else is here, and how a mention works.
    const block = await roomBlock(started.sessionId);
    expect(block).toContain(
      `you are ${lead.displayName}, the Developer, in this conversation with ${researcher.displayName} (Researcher)`,
    );
    expect(block).toContain("write @Name in your reply");
    expect(block).toContain("joins this conversation and works in its own worktree");
    expect(block).not.toContain("cannot change files");
    const member = await roomBlock(joined.sessionId);
    expect(member).toContain(`you are ${researcher.displayName}, the Researcher`);
    // A member writes in its own worktree and learns where each agent works.
    expect(member).not.toContain("cannot change files");
    expect(member).toContain("write only in yours");
    expect(member).toContain(`- You: ${joined.launch.workingDirectory}`);
    expect(member).toContain(`- ${lead.displayName}: ${started.launch.workingDirectory}`);
    // Every agent learns how to hand work to a teammate, with the teammate's ID, and the channels.
    expect(member).toContain(`${lead.displayName} (Developer, ${lead.agentId})`);
    expect(member).toContain(
      "add `--lead <agent ID>` to hand it to the teammate whose topic it is",
    );
    expect(member).toContain("Never message another session through a provider's own tools");
    expect(await roomBlock("00000000-0000-4000-8000-000000000000")).toBeNull();

    // Joining again continues the member's session in its own worktree, and reopening still
    // opens the lead's.
    const again = await joinWorkspaceRoom({ workspaceId, agentId: researcher.agentId });
    expect(again).toMatchObject({ resumed: true, sessionId: joined.sessionId });
    expect(again.lead).toBeUndefined();
    expect(again.launch.workingDirectory).toBe(joined.launch.workingDirectory);
    expect(again.launch.arguments).toEqual(expect.arrayContaining(["--resume"]));
    expect((await openWorkspace(workspaceId)).sessionId).toBe(started.sessionId);
    expect((await listWorkspaces()).workspaces).toHaveLength(1);

    await expect(
      joinWorkspaceRoom({ workspaceId, agentId: `agt_${"0".repeat(24)}`, instruction: "Hi." }),
    ).rejects.toMatchObject({ code: "mention_target_inactive" });
  });
});

describe("conversations an agent starts", () => {
  it("prepares the agent's own conversation and opens its lead from the delivered first turn", async () => {
    const app = await fixture();
    const ciel = await registerAgent({
      repositoryRoot: app.repository,
      roleId: "developer",
      origin: "team",
    });
    // Ciel works in a conversation whose session host answers questions with choices.
    await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [ciel.agentId],
      questions: true,
    });
    const started = await startAgentConversation(
      {
        instruction,
        repository: app.projectId,
        startedBy: ciel.agentId,
        title: "Fix retry budget",
      },
      { ...process.env, LERVO_AGENT_ID: ciel.agentId },
    );
    expect(await pendingStartsOf(pendingStartsPath(), ciel.agentId)).toMatchObject([
      { workspaceId: started.workspaceId, title: "Fix retry budget", text: instruction },
    ]);
    const listed = (await listWorkspaces()).workspaces.find(
      (workspace) => workspace.workspaceId === started.workspaceId,
    );
    expect(listed).toMatchObject({ title: "Fix retry budget", agentId: ciel.agentId });

    // The delivery that opens it gives the lead its own prepared session, with write access.
    const opened = await joinWorkspaceRoom({
      workspaceId: started.workspaceId,
      agentId: ciel.agentId,
      instruction: "[Lervo room] From Ciel (Developer):\nFix the retry budget.",
    });
    expect(opened).toMatchObject({ lead: true, sessionId: started.sessionId, resumed: false });
    expect(opened.launch.arguments).not.toContain("dontAsk");
    // The conversation it started answers questions with choices, as Ciel's own session does.
    expect(opened.launch.arguments).toContain("--permission-prompt-tool");
    expect(opened.launch.initialInput).toBe(
      "[Lervo room] From Ciel (Developer):\nFix the retry budget.",
    );
    expect(await pendingStartsOf(pendingStartsPath(), ciel.agentId)).toEqual([]);
    expect((await openWorkspace(started.workspaceId)).sessionId).toBe(started.sessionId);
  });

  it("hands a conversation to a teammate, who leads it and writes", async () => {
    const app = await fixture();
    const bora = await registerAgent({
      repositoryRoot: app.repository,
      roleId: "developer",
      origin: "team",
    });
    const machining = await registerAgent({
      repositoryRoot: app.repository,
      roleId: "developer",
      origin: "team",
    });
    const as = { ...process.env, LERVO_AGENT_ID: bora.agentId };
    const started = await startAgentConversation(
      {
        instruction,
        repository: app.projectId,
        startedBy: bora.agentId,
        lead: machining.agentId,
        title: "Port the verifier",
      },
      as,
    );
    // Bora's turn delivers it; Machining leads it.
    expect(await pendingStartsOf(pendingStartsPath(), bora.agentId)).toMatchObject([
      { workspaceId: started.workspaceId, agentId: machining.agentId, startedBy: bora.agentId },
    ]);
    const listed = (await listWorkspaces()).workspaces.find(
      (workspace) => workspace.workspaceId === started.workspaceId,
    );
    expect(listed).toMatchObject({ agentId: machining.agentId, participants: [machining.agentId] });
    const opened = await joinWorkspaceRoom({
      workspaceId: started.workspaceId,
      agentId: machining.agentId,
      instruction: "[Lervo room] From Bora (Developer):\nPort the verifier.",
    });
    expect(opened).toMatchObject({ lead: true, sessionId: started.sessionId });
    expect(opened.launch.arguments).not.toContain("dontAsk");
    expect(await pendingStartsOf(pendingStartsPath(), bora.agentId)).toEqual([]);

    // Work for that conversation goes there, to Machining, when Bora's turn ends.
    const queued = await sendToConversation(
      { workspaceId: started.workspaceId, from: bora.agentId, text: "Then start step 2." },
      as,
    );
    expect(queued).toMatchObject({ status: "queued", agentId: machining.agentId });
    expect(await pendingSendsOf(pendingSendsPath(), bora.agentId)).toMatchObject([
      {
        workspaceId: started.workspaceId,
        sessionId: started.sessionId,
        text: "Then start step 2.",
      },
    ]);
    await expect(
      sendToConversation(
        { workspaceId: started.workspaceId, from: machining.agentId, text: "Hi." },
        { ...process.env, LERVO_AGENT_ID: machining.agentId },
      ),
    ).rejects.toMatchObject({ code: "send_target_self" });
    await expect(
      sendToConversation(
        { workspaceId: started.workspaceId, from: bora.agentId, text: "Hi." },
        { ...process.env, LERVO_AGENT_ID: machining.agentId },
      ),
    ).rejects.toMatchObject({ code: "agent_not_caller" });
    // A lead whose session stopped resumes as the conversation's own session to receive it.
    const resumed = await joinWorkspaceRoom({
      workspaceId: started.workspaceId,
      agentId: machining.agentId,
      instruction: "[Lervo room] From Bora (Developer):\nThen start step 2.",
    });
    expect(resumed).toMatchObject({ lead: true, resumed: true, sessionId: started.sessionId });

    // Only the calling session's agent starts, and only for an active teammate.
    await expect(
      startAgentConversation(
        {
          instruction,
          repository: app.projectId,
          startedBy: bora.agentId,
          lead: machining.agentId,
        },
        { ...process.env, LERVO_AGENT_ID: machining.agentId },
      ),
    ).rejects.toMatchObject({ code: "agent_not_caller" });
    await expect(
      startAgentConversation(
        {
          instruction,
          repository: app.projectId,
          startedBy: bora.agentId,
          lead: `agt_${"0".repeat(24)}`,
        },
        as,
      ),
    ).rejects.toMatchObject({ code: "participant_invalid" });
  });
});
