import { lstat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_TASK_TYPE,
  listAssignments,
  listConversationChangedPaths,
  listConversationWorkspaceGenerations,
  readWorkspace,
} from "@lervo/agent-workforce";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import { retireHostedWorkspace } from "../src/hosted-workspace-retire.js";
import { hostedWorkspaceRetireEffects } from "../src/hosted-workspace-retire-effects.js";
import { runTerminalHookCommand } from "../src/terminal-hook-command.js";
import { parseTerminalHookIngress } from "../src/terminal-hook-input.js";
import { createTerminalStageObservation } from "../src/terminal-stage-observation.js";
import { answerClaimHook } from "../src/write-claims.js";
import { claimFixture, eventsOf, git, type ClaimFixture } from "./conversation-claim-fixture.js";

let app: ClaimFixture;

beforeEach(async () => {
  app = await claimFixture();
}, 60_000);

afterEach(async () => {
  await app.cleanup();
});

/** What the claim hook answers for a `Write` of `path`, relative to the session's worktree. */
function write(sessionId: string, worktree: string, path: string) {
  const parsed = parseTerminalHookIngress(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Write",
      tool_input: { file_path: resolve(worktree, path), content: "x" },
      tool_use_id: "toolu_1",
      cwd: worktree,
    }),
  );
  if (parsed.event !== "PreToolUse") throw new Error("not a pre-tool input");
  return answerClaimHook(parsed, "claude", worktree);
}

/** Runs the `Stop` hook, which reconciles the conversation's changed paths. */
async function stop(sessionId: string, worktree: string): Promise<void> {
  const exitCode = await runTerminalHookCommand(
    ["--provider", "claude", "--contract", "2"],
    {
      cwd: worktree,
      stdout: () => undefined,
      stderr: () => undefined,
      stdin: async () => JSON.stringify({ hook_event_name: "Stop", session_id: sessionId }),
    },
    { createTerminalStageObservation },
  );
  expect(exitCode).toBe(0);
}

async function assignmentOf(agentId: string) {
  return (await listAssignments(app.repository)).find(
    (item) => item.taskType === CONVERSATION_TASK_TYPE && item.assigneeAgentId === agentId,
  )!;
}

describe("retiring a conversation's workspace", () => {
  it("releases its lease, removes its records and changed paths, and frees its paths", async () => {
    const { first, second, repository } = app;
    // The first conversation claims, changes, and commits src/a.ts; its Stop records the change.
    expect(await write(first.sessionId, first.worktree, "src/a.ts")).toBe("{}\n");
    await writeFile(resolve(first.worktree, "src/a.ts"), "export const a = 2;\n");
    await git(first.worktree, "add", "-A");
    await git(first.worktree, "commit", "-m", "a");
    await stop(first.sessionId, first.worktree);
    const changes = await listConversationChangedPaths(repository);
    const [generation] = await listConversationWorkspaceGenerations(repository, first.workspaceId);
    expect(changes.get(generation!.workspaceId)?.paths).toEqual(["src/a.ts"]);
    expect((await assignmentOf(first.leadAgentId)).lease).not.toBeNull();
    // Meanwhile the second conversation cannot claim it.
    expect(await write(second.sessionId, second.worktree, "src/a.ts")).toContain('"deny"');

    await expect(
      retireHostedWorkspace(first.workspaceId, hostedWorkspaceRetireEffects()),
    ).resolves.toMatchObject({ workspaceId: first.workspaceId, worktree: "removed" });

    const assignment = await assignmentOf(first.leadAgentId);
    expect(assignment).toMatchObject({ status: "cancelled", lease: null });
    expect(await eventsOf(repository, "assignment.cancelled")).toMatchObject([
      { payload: { assignmentId: assignment.assignmentId, previousStatus: "leased" } },
    ]);
    expect(
      (await listConversationWorkspaceGenerations(repository, first.workspaceId)).map(
        (workspace) => [workspace.state, workspace.recoveryReason],
      ),
    ).toEqual([["removed", "conversation_retired"]]);
    expect((await listConversationChangedPaths(repository)).has(generation!.workspaceId)).toBe(
      false,
    );
    await expect(lstat(first.worktree)).rejects.toMatchObject({ code: "ENOENT" });
    // The second conversation now claims the path the retired one held.
    expect(await write(second.sessionId, second.worktree, "src/a.ts")).toBe("{}\n");
    // The second conversation's records stay.
    expect(
      (await listConversationWorkspaceGenerations(repository, second.workspaceId)).map(
        (workspace) => workspace.state,
      ),
    ).toEqual(["ready"]);
  }, 60_000);

  it("refuses, changing nothing, while a sealed change waits for integration", async () => {
    const { first, repository } = app;
    const [generation] = await listConversationWorkspaceGenerations(repository, first.workspaceId);
    // Sealing arrives with slice 2; a record already queued for integration stands in for it.
    const records = await RepositoryCoordinationRecords.open(repository);
    const stored = (await readWorkspace(repository, generation!.workspaceId))!;
    await records.write({
      collection: "workspaces",
      recordId: generation!.workspaceId,
      value: { ...stored.workspace, state: "integration_pending" },
      expectedContentHash: stored.contentHash,
    });
    await expect(
      retireHostedWorkspace(first.workspaceId, hostedWorkspaceRetireEffects()),
    ).rejects.toMatchObject({ code: "workspace_integration_pending" });
    expect(await lstat(first.worktree)).toBeTruthy();
    expect(await assignmentOf(first.leadAgentId)).toMatchObject({ status: "leased" });
  }, 60_000);

  it("leaves a conversation's coordination alone while the gate is closed", async () => {
    const { first, repository } = app;
    vi.stubEnv("LERVO_COORDINATION", "0");
    await expect(
      retireHostedWorkspace(first.workspaceId, hostedWorkspaceRetireEffects()),
    ).resolves.toMatchObject({ worktree: "removed" });
    expect(await assignmentOf(first.leadAgentId)).toMatchObject({ status: "leased" });
    expect(
      (await listConversationWorkspaceGenerations(repository, first.workspaceId)).map(
        (workspace) => workspace.state,
      ),
    ).toEqual(["ready"]);
  }, 60_000);
});
