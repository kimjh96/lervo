// A field canary on 2026-11-27: a host whose installed hook runtime predated conversation
// workspaces read generation 1's record as a worker's and blocked the lead's first prompt with
// `assignment_scope_changed`. The current runtime must attach nothing there and answer the prompt.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readNewestConversationWorkspace } from "@lervo/agent-workforce";

import { runTerminalHookCommand } from "../src/terminal-hook-command.js";
import { createTerminalStageObservation } from "../src/terminal-stage-observation.js";
import { claimFixture, type ClaimFixture } from "./conversation-claim-fixture.js";

let app: ClaimFixture;

beforeEach(async () => {
  app = await claimFixture();
}, 60_000);

afterEach(async () => {
  await app.cleanup();
});

/** What the `UserPromptSubmit` hook prints in the session's worktree. */
async function prompt(sessionId: string, worktree: string): Promise<string> {
  const stdout: string[] = [];
  const exitCode = await runTerminalHookCommand(
    ["--provider", "claude", "--contract", "2"],
    {
      cwd: worktree,
      stdout: (message) => stdout.push(message),
      stderr: () => undefined,
      stdin: async () =>
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: sessionId,
          turn_id: "turn-1",
          prompt: "Change the log format to one line per request.",
        }),
    },
    { createTerminalStageObservation },
  );
  expect(exitCode).toBe(0);
  return stdout.join("");
}

describe("a conversation's first prompt", () => {
  it("answers in the conversation's worktree without a worker attachment", async () => {
    const { first, repository } = app;
    const before = (await readNewestConversationWorkspace(repository, first.workspaceId))!;
    expect(before).toMatchObject({ kind: "conversation", generation: 1, state: "ready" });

    const answer = await prompt(first.sessionId, first.worktree);
    expect(answer).not.toContain('"decision":"block"');
    expect(answer).not.toContain("assignment_scope_changed");
    const parsed = JSON.parse(answer) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Lervo compact terminal context");
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("Lervo context degraded");

    // The record stays the conversation's: no worker activation took it over.
    const after = (await readNewestConversationWorkspace(repository, first.workspaceId))!;
    expect(after).toMatchObject({ state: "ready", revision: before.revision, writerSession: null });
  }, 60_000);
});
