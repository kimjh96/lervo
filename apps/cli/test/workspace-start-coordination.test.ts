import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_TASK_TYPE,
  createWorkspace,
  listAssignments,
  listWorkspaces,
  readNewestConversationWorkspace,
  readOrCreateClaimPathKey,
  registerAgent,
  widenConversationLease,
  type AgentWorkspace,
} from "@lervo/agent-workforce";
import {
  openProjectStorage,
  repositoryCoordinateDigest,
  RepositoryCoordinationRecords,
} from "@lervo/project-storage";

import { conversationLeaseEventRecorder } from "../src/conversation-lease-events.js";
import { runCli } from "../src/main.js";
import { resolveTerminalRoots } from "../src/terminal-roots.js";
import { attachTerminalWorkspace } from "../src/terminal-workspace-attachment.js";
import {
  terminalWorkspaceDigest,
  terminalWorkspaceMarker,
  terminalWriterSessionId,
} from "../src/terminal-workspace-boundary.js";
import { openWorkspace, startWorkspaceFromInstruction } from "../src/workspace-launch-service.js";

/** A claim failure the next coordination stage meets, after its assignment was created. */
const claimFailure = vi.hoisted(() => ({ next: null as Error | null }));
vi.mock("@lervo/agent-workforce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lervo/agent-workforce")>();
  return {
    ...actual,
    claimAssignment: (input: Parameters<typeof actual.claimAssignment>[0]) => {
      const failure = claimFailure.next;
      claimFailure.next = null;
      return failure === null ? actual.claimAssignment(input) : Promise.reject(failure);
    },
  };
});

const execute = promisify(execFile);
const roots: string[] = [];
const instruction = "Change the log format\nUse one line per request.";

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

/** A registered Lervo repository whose writer selects `schemaVersion`. */
async function fixture(
  schemaVersion: number | null,
  options: { gate?: boolean; linkedHome?: boolean } = {},
) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-workspace-coordination-")));
  roots.push(root);
  const repository = resolve(root, "app");
  const state = resolve(root, "state");
  const bin = resolve(root, "bin");
  await mkdir(repository);
  await mkdir(bin);
  await writeFile(resolve(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  // A home reached through a symbolic link names the worktree by a path that is not its real one.
  if (options.linkedHome === true) {
    await mkdir(resolve(root, "real-workspaces"));
    await symlink(resolve(root, "real-workspaces"), resolve(root, "workspaces"));
  }
  vi.stubEnv("LERVO_WORKSPACES_HOME", resolve(root, "workspaces"));
  vi.stubEnv("LERVO_COORDINATION", options.gate === false ? "0" : "1");
  vi.stubEnv("CLAUDE_CONFIG_DIR", resolve(root, "claude"));
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
  await git(repository, "init", "--initial-branch", "main");
  await git(repository, "config", "user.email", "lervo-test@example.invalid");
  await git(repository, "config", "user.name", "Lervo Test");
  await writeFile(resolve(repository, "README.md"), "app\n");
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
  if (schemaVersion !== null) await activateSchema(root, repository, schemaVersion);
  const lead = await registerAgent({
    repositoryRoot: repository,
    roleId: "developer",
    origin: "team",
  });
  return { root, repository, projectId: registration.projectId, lead };
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

async function events(repository: string) {
  const storage = await openProjectStorage(repository);
  try {
    return storage.events.list();
  } finally {
    await storage.close();
  }
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("the coordination stage of lervo workspace start", () => {
  it("binds the lead's lease and generation 1 to the worktree when the writer selects 16", async () => {
    const app = await fixture(16);
    const started = await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [app.lead.agentId],
    });
    expect(started.coordination).toEqual({ status: "active" });
    const worktree = started.launch.workingDirectory;

    const [assignment] = (await listAssignments(app.repository)).filter(
      (item) => item.taskType === CONVERSATION_TASK_TYPE,
    );
    expect(assignment).toMatchObject({
      status: "leased",
      roleId: "developer",
      roleVersion: app.lead.roleVersion,
      roleContractHash: app.lead.roleContractHash,
      accessMode: "write",
      expectedPaths: [],
      priority: 50,
      workstreamId: started.workstreamId,
      acceptanceCriteria: ["The conversation's sealed change passes its verification."],
      lease: {
        agentId: app.lead.agentId,
        sessionId: terminalWriterSessionId("claude", started.sessionId),
        generation: 1,
      },
    });
    expect(
      Date.parse(assignment!.lease!.expiresAt) - Date.parse(assignment!.lease!.acquiredAt),
    ).toBe(10 * 60_000);

    const workspace = (await readNewestConversationWorkspace(app.repository, started.workspaceId))!;
    expect(workspace).toMatchObject({
      kind: "conversation",
      conversationId: started.workspaceId,
      generation: 1,
      state: "ready",
      assignmentId: assignment!.assignmentId,
      agentId: app.lead.agentId,
      leaseGeneration: 1,
      baseCommit: await git(worktree, "rev-parse", "HEAD"),
      integrationTargetDigest: repositoryCoordinateDigest("refs/heads/main"),
      pathDigest: repositoryCoordinateDigest(worktree),
      ownerWorkspacePath: worktree,
      writerSession: null,
    });
    // The record is bound to the marker the start wrote in the worktree's Git directory.
    const gitDirectory = await git(worktree, "rev-parse", "--path-format=absolute", "--git-dir");
    const marker = JSON.parse(
      await readFile(resolve(gitDirectory, "lervo-workspace-owner.json"), "utf8"),
    ) as unknown;
    expect(marker).toEqual(terminalWorkspaceMarker(workspace));
    expect(terminalWorkspaceDigest(marker)).toBe(workspace.markerHash);

    const types = (await events(app.repository)).map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(["assignment.created", "assignment.claimed"]));

    // Every session in the worktree claims: the start wrote the claim handler into its local
    // settings, which the repository's info/exclude keeps from showing as a change.
    const local = JSON.parse(
      await readFile(resolve(worktree, ".claude/settings.local.json"), "utf8"),
    ) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
    expect(local.hooks.PreToolUse).toHaveLength(1);
    expect(local.hooks.PreToolUse[0]!.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit|Bash");
    expect(local.hooks.PreToolUse[0]!.hooks[0]!.command).toMatch(
      / --provider claude --contract 2 --claim$/u,
    );
    expect(await git(worktree, "status", "--porcelain", "--", ".claude")).toBe("");

    // A conversation's checkout keeps ADR-0633's two roots and attaches no worker binding.
    expect(await resolveTerminalRoots(worktree)).toEqual({
      executionRoot: worktree,
      evidenceRoot: app.repository,
      reason: "linked_worktree",
    });
    expect(
      await attachTerminalWorkspace({
        root: worktree,
        provider: "claude",
        providerSessionId: started.sessionId,
      }),
    ).toBeNull();

    // A claim grows the lease through the schema 16 recorder in the repository's store.
    const storage = await openProjectStorage(app.repository);
    try {
      const widened = await widenConversationLease({
        repositoryRoot: app.repository,
        assignmentId: assignment!.assignmentId,
        agentId: app.lead.agentId,
        sessionId: assignment!.lease!.sessionId,
        paths: ["README.md"],
        mode: "request",
        detection: "tool",
        claimantWorkspaceId: started.workspaceId,
        claimPathKey: await readOrCreateClaimPathKey(app.repository),
        recordEvent: conversationLeaseEventRecorder(storage),
      });
      expect(widened).toMatchObject({ status: "widened", addedPaths: ["README.md"] });
    } finally {
      await storage.close();
    }
    const recorded = (await events(app.repository)).find(
      (event) => event.type === "assignment.lease.widened",
    );
    expect(recorded).toMatchObject({
      schemaVersion: 16,
      payload: { assignmentId: assignment!.assignmentId, expectedPathCount: 1, cause: "claim" },
    });
  });

  it("keeps a claiming conversation claiming when it reopens without the worktree's handler", async () => {
    const app = await fixture(16);
    const started = await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [app.lead.agentId],
    });
    expect(started.coordination).toEqual({ status: "active" });
    // The worktree's handler runs Lervo, so the reopened session's own settings add none.
    const settings = (opened: Awaited<ReturnType<typeof openWorkspace>>) =>
      opened.launch.settingsFile?.content ?? "";
    expect(settings(await openWorkspace(started.workspaceId))).not.toContain("--claim");
    await rm(resolve(started.launch.workingDirectory, ".claude/settings.local.json"));
    const reopened = settings(await openWorkspace(started.workspaceId));
    expect(reopened).toContain('"matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash"');
    expect(reopened).toMatch(/--provider claude --contract 2 --claim"/u);
  });

  it("stays inactive below schema 16 and starts the conversation without claims", async () => {
    const app = await fixture(null);
    const started = await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [app.lead.agentId],
    });
    expect(started.coordination).toEqual({ status: "inactive", code: "coordination_inactive" });
    expect(await listWorkspaces(app.repository)).toEqual([]);
    // A conversation that does not claim gets no claim handler.
    await expect(
      readFile(resolve(started.launch.workingDirectory, ".claude/settings.local.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await listAssignments(app.repository)).filter(
        (item) => item.taskType === CONVERSATION_TASK_TYPE,
      ),
    ).toEqual([]);
    // Without a lead there is no coordination stage at all.
    const alone = await startWorkspaceFromInstruction({ instruction, repository: app.projectId });
    expect(alone.coordination).toBeUndefined();

    // The schema 16 recorder refuses, so no lease can grow below 16.
    const storage = await openProjectStorage(app.repository);
    try {
      expect(() =>
        conversationLeaseEventRecorder(storage)({
          type: "assignment.lease.renewed",
          occurredAt: "2026-11-27T00:00:00.000Z",
          actorAgentId: app.lead.agentId,
          payload: {
            assignmentId: `asn_${"a".repeat(24)}`,
            agentId: app.lead.agentId,
            leaseId: `lse_${"a".repeat(24)}`,
            generation: 1,
            expiresAt: "2026-11-27T00:10:00.000Z",
          },
        }),
      ).toThrow(expect.objectContaining({ code: "coordination_inactive" }));
    } finally {
      await storage.close();
    }
  });

  it("stays inactive at schema 16 while the stage's gate is closed", async () => {
    const app = await fixture(16, { gate: false });
    const started = await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [app.lead.agentId],
    });
    expect(started.coordination).toEqual({ status: "inactive", code: "coordination_inactive" });
    expect(await listWorkspaces(app.repository)).toEqual([]);
  });

  it("cancels the new assignment when the lead's claim fails, and starts anyway", async () => {
    const app = await fixture(16);
    claimFailure.next = Object.assign(new Error("busy"), { code: "workforce_busy" });
    const started = await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [app.lead.agentId],
    });
    expect(started.coordination).toEqual({
      status: "unavailable",
      code: "coordination_unavailable",
      cause: "workforce_busy",
    });
    expect(
      (await listAssignments(app.repository))
        .filter((item) => item.taskType === CONVERSATION_TASK_TYPE)
        .map((item) => [item.status, item.lease]),
    ).toEqual([["cancelled", null]]);
    expect(await listWorkspaces(app.repository)).toEqual([]);
    expect((await events(app.repository)).map((event) => event.type)).toEqual(
      expect.arrayContaining(["assignment.created", "assignment.cancelled"]),
    );
  });

  it("names the worktree by its real path when the workspaces home is a symbolic link", async () => {
    const app = await fixture(16, { linkedHome: true });
    const started = await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [app.lead.agentId],
    });
    expect(started.coordination).toEqual({ status: "active" });
    const worktree = started.launch.workingDirectory;
    const real = await realpath(worktree);
    expect(real).not.toBe(worktree);
    const workspace = (await readNewestConversationWorkspace(app.repository, started.workspaceId))!;
    expect(workspace).toMatchObject({
      pathDigest: repositoryCoordinateDigest(real),
      ownerWorkspacePath: real,
    });
    const gitDirectory = await git(worktree, "rev-parse", "--path-format=absolute", "--git-dir");
    expect(
      JSON.parse(await readFile(resolve(gitDirectory, "lervo-workspace-owner.json"), "utf8")),
    ).toEqual(terminalWorkspaceMarker(workspace));
    // Through the link or its real path, the session finds the conversation's two roots.
    for (const cwd of [worktree, real])
      expect(await resolveTerminalRoots(cwd)).toMatchObject({
        evidenceRoot: app.repository,
        reason: "linked_worktree",
      });
    expect(
      await attachTerminalWorkspace({
        root: worktree,
        provider: "claude",
        providerSessionId: started.sessionId,
      }),
    ).toBeNull();
  });

  it("keeps one root for a worker workspace beside a conversation's", async () => {
    const app = await fixture(16);
    const worktree = resolve(app.root, "worker");
    await git(app.repository, "worktree", "add", "-q", "-b", "worker", worktree);
    const records = await RepositoryCoordinationRecords.open(app.repository);
    const worker: AgentWorkspace = {
      schemaVersion: 1,
      workspaceId: "wsp_aaaaaaaaaaaaaaaaaaaaaaaa",
      generation: 1,
      repositoryInstanceId: records.home.repositoryInstanceId,
      projectId: app.projectId,
      assignmentId: `asn_${"a".repeat(24)}`,
      agentId: app.lead.agentId,
      leaseGeneration: 1,
      executionKind: "worker",
      host: { kind: "git", version: "1.0.0", nativeInstanceDigest: null },
      baseCommit: await git(worktree, "rev-parse", "HEAD"),
      integrationTargetDigest: repositoryCoordinateDigest("refs/heads/main"),
      creationPlanId: "wpl_aaaaaaaaaaaaaaaaaaaaaaaa",
      markerHash: `sha256:${"a".repeat(64)}`,
      pathDigest: repositoryCoordinateDigest(worktree),
      state: "provisioning",
      writerSession: null,
      sealedResult: null,
      integrationQueueEntryId: null,
      integrationEvidenceId: null,
      cleanupPlanId: null,
      recoveryReason: null,
      revision: 1,
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    };
    await createWorkspace({
      repositoryRoot: app.repository,
      workspace: worker,
      eventId: "evt_worker_workspace_01",
    });
    await startWorkspaceFromInstruction({
      instruction,
      repository: app.projectId,
      participants: [app.lead.agentId],
    });
    expect(await resolveTerminalRoots(worktree)).toEqual({
      executionRoot: worktree,
      evidenceRoot: worktree,
      reason: "worker_workspace",
    });
  });
});
