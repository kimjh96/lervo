import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_TASK_TYPE,
  listAssignments,
  listConversationChangedPaths,
  listConversationWorkspaceGenerations,
} from "@lervo/agent-workforce";
import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";

import { sweepGoneConversationWorktrees } from "../src/conversation-worktree-sweep.js";
import { runCli } from "../src/main.js";
import { runTerminalHookCommand } from "../src/terminal-hook-command.js";
import { parseTerminalHookIngress } from "../src/terminal-hook-input.js";
import { createTerminalStageObservation } from "../src/terminal-stage-observation.js";
import { applyWorkforceUpkeep } from "../src/upgrade-workforce-upkeep.js";
import { answerClaimHook } from "../src/write-claims.js";
import { claimFixture, git, type ClaimFixture } from "./conversation-claim-fixture.js";

const execute = promisify(execFile);
let app: ClaimFixture | null = null;
let plain: string | null = null;

afterEach(async () => {
  await app?.cleanup();
  app = null;
  if (plain !== null) await rm(plain, { recursive: true, force: true });
  plain = null;
  vi.unstubAllEnvs();
});

/** Claims `path` for the conversation's lead and records the change at its `Stop`. */
async function recordChange(sessionId: string, worktree: string, path: string): Promise<void> {
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
  expect(await answerClaimHook(parsed, "claude", worktree)).toBe("{}\n");
  await writeFile(resolve(worktree, path), "changed\n");
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

async function assignmentOf(fixture: ClaimFixture, agentId: string) {
  return (await listAssignments(fixture.repository)).find(
    (item) => item.taskType === CONVERSATION_TASK_TYPE && item.assigneeAgentId === agentId,
  )!;
}

async function generations(fixture: ClaimFixture, conversationId: string) {
  return (await listConversationWorkspaceGenerations(fixture.repository, conversationId)).map(
    (workspace) => [workspace.state, workspace.recoveryReason],
  );
}

describe("sweeping conversations whose worktree is gone", () => {
  it("ends a vanished conversation's coordination with the gate closed, keeping a live one", async () => {
    app = await claimFixture();
    const { first, second, repository } = app;
    await recordChange(first.sessionId, first.worktree, "src/a.ts");
    const [generation] = await listConversationWorkspaceGenerations(repository, first.workspaceId);
    vi.stubEnv("LERVO_COORDINATION", "0");

    // The directory is gone but Git still registers the worktree: nothing is proven yet.
    await rm(first.worktree, { recursive: true, force: true });
    expect(await sweepGoneConversationWorktrees(repository)).toEqual({
      retiredConversationCount: 0,
    });
    expect(await generations(app, first.workspaceId)).toEqual([["ready", null]]);

    await git(repository, "worktree", "prune");
    const receipt = { appliedStages: [] as string[], skippedStages: [] };
    await applyWorkforceUpkeep(repository, receipt);
    expect(receipt.appliedStages).toContain("conversation_worktree_sweep");
    expect(receipt.skippedStages).toEqual([]);
    expect(await assignmentOf(app, first.leadAgentId)).toMatchObject({
      status: "cancelled",
      lease: null,
    });
    expect(await generations(app, first.workspaceId)).toEqual([
      ["removed", "conversation_worktree_gone"],
    ]);
    expect((await listConversationChangedPaths(repository)).has(generation!.workspaceId)).toBe(
      false,
    );
    // The conversation whose worktree exists keeps its lease and records.
    expect(await lstat(second.worktree)).toBeTruthy();
    expect(await assignmentOf(app, second.leadAgentId)).toMatchObject({ status: "leased" });
    expect(await generations(app, second.workspaceId)).toEqual([["ready", null]]);

    // A second sweep finds nothing left to end.
    expect(await sweepGoneConversationWorktrees(repository)).toEqual({
      retiredConversationCount: 0,
    });
  }, 60_000);

  it("changes nothing in a repository where no conversation coordinated", async () => {
    plain = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-sweep-")));
    const repository = resolve(plain, "app");
    await mkdir(repository);
    vi.stubEnv("LERVO_USER_STATE_DIRECTORY", resolve(plain, "state"));
    await execute("git", ["-C", repository, "init", "--initial-branch", "main"]);
    const io = {
      cwd: plain,
      stdout: () => undefined,
      stderr: () => undefined,
      stdin: async () => "",
    };
    expect(await runCli(["init", "--root", repository, "--name", "app"], io)).toBe(0);
    const before = await inspectRepositoryCoordinationHome(repository);

    const receipt = { appliedStages: [] as string[], skippedStages: [] };
    await applyWorkforceUpkeep(repository, receipt);
    expect(receipt.skippedStages).toEqual([]);
    expect(receipt.appliedStages).not.toContain("conversation_worktree_sweep");
    expect((await inspectRepositoryCoordinationHome(repository)) === null).toBe(before === null);
  }, 60_000);
});
