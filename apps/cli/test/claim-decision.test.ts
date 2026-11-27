import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentWorkforceError,
  CONVERSATION_TASK_TYPE,
  listAssignments,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";

import { ClaimLog, claimLogPath } from "../src/claim-log.js";
import { localClockTime } from "../src/claim-message.js";
import { terminalProviderSessionDigest } from "../src/terminal-event-coordinates.js";
import { parseTerminalHookIngress } from "../src/terminal-hook-input.js";
import { openTerminalTurn } from "../src/terminal-open-turns.js";
import { answerClaimHook } from "../src/write-claims.js";
import { claimFixture, eventsOf, type ClaimFixture } from "./conversation-claim-fixture.js";

/** Each widening the claims ask for, and a failure the next one meets. */
const widening = vi.hoisted(() => ({ calls: 0, failure: null as Error | null }));
vi.mock("@lervo/agent-workforce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lervo/agent-workforce")>();
  return {
    ...actual,
    widenConversationLease: (input: Parameters<typeof actual.widenConversationLease>[0]) => {
      widening.calls += 1;
      const failure = widening.failure;
      widening.failure = null;
      return failure === null ? actual.widenConversationLease(input) : Promise.reject(failure);
    },
  };
});

let app: ClaimFixture;

beforeEach(async () => {
  widening.calls = 0;
  widening.failure = null;
  app = await claimFixture();
}, 60_000);

afterEach(async () => {
  await app.cleanup();
});

function preToolUse(
  sessionId: string,
  cwd: string,
  tool_name: string,
  tool_input: object,
  tool_use_id = "toolu_1",
) {
  const parsed = parseTerminalHookIngress(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name,
      tool_input,
      tool_use_id,
      cwd,
    }),
  );
  if (parsed.event !== "PreToolUse") throw new Error("not a pre-tool input");
  return parsed;
}

/** What the hook prints for a `Write` of `path` in the session's working directory. */
function write(sessionId: string, cwd: string, path: string, toolUseId?: string) {
  return answerClaimHook(
    preToolUse(sessionId, cwd, "Write", { file_path: path, content: "x" }, toolUseId),
    "claude",
    cwd,
  );
}

function denial(answer: string): string | null {
  const output = JSON.parse(answer) as {
    hookSpecificOutput?: { permissionDecision: string; permissionDecisionReason: string };
  };
  return output.hookSpecificOutput?.permissionDecision === "deny"
    ? output.hookSpecificOutput.permissionDecisionReason
    : null;
}

async function conversationAssignment(agentId: string): Promise<WorkforceAssignment> {
  const found = (await listAssignments(app.repository)).find(
    (item) => item.taskType === CONVERSATION_TASK_TYPE && item.lease?.agentId === agentId,
  );
  return found!;
}

function claimLogEntries(sessionId: string) {
  const log = ClaimLog.openExisting(claimLogPath());
  if (log === null) return [];
  try {
    return [
      ...log.refusedSince(sessionId, "1970-01-01T00:00:00.000Z"),
      ...log.deferredSince(sessionId, "1970-01-01T00:00:00.000Z"),
    ];
  } finally {
    log.close();
  }
}

describe("claims at first write in a conversation's worktree", () => {
  it("widens the lease by a new path, then answers inside the lease without the lock", async () => {
    const { first } = app;
    expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`)).toBe("{}\n");
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual(["src/a.ts"]);
    expect(await eventsOf(app.repository, "assignment.lease.widened")).toMatchObject([
      { payload: { expectedPathCount: 1, addedPathCount: 1, cause: "claim" } },
    ]);
    expect(widening.calls).toBe(1);

    // The same path again sits inside a lease with more than 30 seconds left.
    expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`)).toBe("{}\n");
    expect(widening.calls).toBe(1);
    expect(await eventsOf(app.repository, "assignment.lease.widened")).toHaveLength(1);
  });

  it("denies another conversation's write and names the holder, its conversation, and its time", async () => {
    const { first, second } = app;
    await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`);
    const held = await conversationAssignment(first.leadAgentId);

    const answer = await write(second.sessionId, second.worktree, `${second.worktree}/src/a.ts`);
    expect(denial(answer)).toBe(
      `Lervo stopped this write. \`src/a.ts\` is claimed by Arin (Developer) in the conversation "Log format" until ${localClockTime(held.lease!.expiresAt)}. Two agents changing one path in parallel conflict when their work integrates. Do not write this path another way. Mention @Arin with the change you need, continue with other paths, or try again after Arin's change is sealed.`,
    );
    expect((await conversationAssignment(second.leadAgentId)).expectedPaths).toEqual([]);
    expect(await eventsOf(app.repository, "assignment.claim.refused")).toMatchObject([
      {
        payload: {
          code: "path_leased",
          holderAgentId: first.leadAgentId,
          holderAssignmentId: held.assignmentId,
          holderWorkspaceId: first.workspaceId,
          detection: "tool",
        },
      },
    ]);
    expect(claimLogEntries(second.sessionId)).toMatchObject([
      {
        decision: "deny",
        code: "path_leased",
        paths: ["src/a.ts"],
        holder: { agentId: first.leadAgentId, workspaceId: first.workspaceId },
      },
    ]);
    // Another path is still the second conversation's to claim.
    expect(await write(second.sessionId, second.worktree, `${second.worktree}/src/b.ts`)).toBe(
      "{}\n",
    );
  });

  it("records one refusal event per path and holder in a turn", async () => {
    const { first, second } = app;
    await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`);
    await openTerminalTurn(app.repository, {
      provider: "claude",
      providerSessionDigest: terminalProviderSessionDigest("claude", second.sessionId),
      providerTurnDigest: null,
      contextEventId: "evt_claim_turn_0001",
      openedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    for (const toolUseId of ["toolu_1", "toolu_2"])
      expect(
        denial(
          await write(second.sessionId, second.worktree, `${second.worktree}/src/a.ts`, toolUseId),
        ),
      ).not.toBeNull();
    expect(await eventsOf(app.repository, "assignment.claim.refused")).toHaveLength(1);
    expect(claimLogEntries(second.sessionId)).toHaveLength(2);
  });

  it("refuses a target in another checkout of the repository", async () => {
    const { first } = app;
    const answer = await write(first.sessionId, first.worktree, `${app.repository}/README.md`);
    expect(denial(answer)).toMatch(
      /^Lervo stopped this write\. `README\.md` is in another checkout/u,
    );
    expect(await eventsOf(app.repository, "assignment.claim.refused")).toMatchObject([
      { payload: { code: "path_outside_workspace", holderAgentId: null } },
    ]);
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([]);
  });

  it("claims nothing for Lervo's runtime paths, ignored paths, or paths outside every checkout", async () => {
    const { first } = app;
    await mkdir(resolve(first.worktree, ".lervo/state"), { recursive: true });
    for (const path of [
      `${first.worktree}/.lervo/state/notes.json`,
      `${first.worktree}/debug.log`,
      resolve(app.root, "elsewhere.txt"),
    ])
      expect(await write(first.sessionId, first.worktree, path)).toBe("{}\n");
    expect(widening.calls).toBe(0);
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([]);
    // A shell write is claimed like a file tool's, with its own detection.
    await writeFile(resolve(first.worktree, "notes.md"), "");
    const shell = await answerClaimHook(
      preToolUse(first.sessionId, first.worktree, "Bash", { command: "printf x > notes.md" }),
      "claude",
      first.worktree,
    );
    expect(shell).toBe("{}\n");
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual(["notes.md"]);
  });

  it("claims under the conversation's assignment from a session without a launch record", async () => {
    const { first } = app;
    expect(await write("owner-terminal", first.worktree, `${first.worktree}/src/owner.ts`)).toBe(
      "{}\n",
    );
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([
      "src/owner.ts",
    ]);
    // The registered repository's own checkout has no conversation and claims nothing.
    expect(await write("owner-terminal", app.repository, `${app.repository}/src/main.ts`)).toBe(
      "{}\n",
    );
    expect(widening.calls).toBe(1);
  });

  it("defers when the workforce stays busy, and the write goes ahead", async () => {
    const { first } = app;
    widening.failure = new AgentWorkforceError("workforce_busy", "busy");
    expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`)).toBe("{}\n");
    expect(claimLogEntries(first.sessionId)).toMatchObject([
      { decision: "defer", code: "workforce_busy", paths: ["src/a.ts"] },
    ]);
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([]);
  });

  it("reads no state while the coordination gate is closed", async () => {
    const { first } = app;
    vi.stubEnv("LERVO_COORDINATION", "0");
    expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`)).toBe("{}\n");
    expect(widening.calls).toBe(0);
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([]);
  });
});
