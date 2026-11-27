import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentWorkforceError,
  CONVERSATION_TASK_TYPE,
  listAssignments,
  listConversationChangedPaths,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";

import { claimLogPath } from "../src/claim-log.js";
import { localClockTime } from "../src/claim-message.js";
import { reconcileExitedSession } from "../src/conversation-turn-reconciliation.js";
import { runTerminalHookCommand } from "../src/terminal-hook-command.js";
import { parseTerminalHookIngress } from "../src/terminal-hook-input.js";
import { createTerminalStageObservation } from "../src/terminal-stage-observation.js";
import { answerClaimHook } from "../src/write-claims.js";
import { claimFixture, eventsOf, git, type ClaimFixture } from "./conversation-claim-fixture.js";

/** A failure the next claim's widening meets, so its write goes ahead unclaimed. */
const widening = vi.hoisted(() => ({ failure: null as Error | null }));
vi.mock("@lervo/agent-workforce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lervo/agent-workforce")>();
  return {
    ...actual,
    widenConversationLease: (input: Parameters<typeof actual.widenConversationLease>[0]) => {
      const failure = widening.failure;
      widening.failure = null;
      return failure === null ? actual.widenConversationLease(input) : Promise.reject(failure);
    },
  };
});

let app: ClaimFixture;

beforeEach(async () => {
  widening.failure = null;
  app = await claimFixture();
}, 60_000);

afterEach(async () => {
  await app.cleanup();
});

/** What the hook prints for a `Write` of `path`, relative to the session's worktree. */
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

/** What the `Stop` hook prints in the session's worktree. */
async function stop(sessionId: string, worktree: string, stopHookActive = false) {
  const stdout: string[] = [];
  const exitCode = await runTerminalHookCommand(
    ["--provider", "claude", "--contract", "2"],
    {
      cwd: worktree,
      stdout: (message) => stdout.push(message),
      stderr: () => undefined,
      stdin: async () =>
        JSON.stringify({
          hook_event_name: "Stop",
          session_id: sessionId,
          stop_hook_active: stopHookActive,
        }),
    },
    { createTerminalStageObservation },
  );
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.join("")) as { decision?: string; reason?: string };
}

async function conversationAssignment(agentId: string): Promise<WorkforceAssignment> {
  return (await listAssignments(app.repository)).find(
    (item) => item.taskType === CONVERSATION_TASK_TYPE && item.lease?.agentId === agentId,
  )!;
}

/** Moves the lead's lease to expire at `expiresAt`, as time passing would. */
async function setLeaseExpiry(agentId: string, expiresAt: Date): Promise<void> {
  const assignment = await conversationAssignment(agentId);
  const home = await resolveRepositoryCoordinationHome(app.repository);
  const path = resolve(home.workforce, "assignments", `${assignment.assignmentId}.json`);
  const value = JSON.parse(await readFile(path, "utf8")) as WorkforceAssignment;
  value.lease = {
    ...value.lease!,
    acquiredAt: new Date(expiresAt.getTime() - 10 * 60_000).toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/** The claim log's entries of a session, with their states, oldest first. */
function claimLogStates(sessionId: string) {
  const database = new DatabaseSync(claimLogPath(), { readOnly: true });
  try {
    return database
      .prepare(
        "SELECT decision, code, paths, tool_use_id, state FROM claims WHERE session_id = ? ORDER BY rowid",
      )
      .all(sessionId)
      .map((row) => {
        const entry = row as Record<string, string | null>;
        return {
          decision: entry.decision,
          code: entry.code,
          paths: JSON.parse(entry.paths!) as string[],
          toolUseId: entry.tool_use_id,
          state: entry.state,
        };
      });
  } finally {
    database.close();
  }
}

async function changedPathsOf(workspaceId: string): Promise<string[] | undefined> {
  const records = await listConversationChangedPaths(app.repository);
  return [...records.values()].find((record) => record.conversationId === workspaceId)?.paths;
}

describe("reconciliation at the turn's end", () => {
  it("records the changed paths, claims the conflict-free part, and blocks the Stop once", async () => {
    const { first, second } = app;
    expect(await write(first.sessionId, first.worktree, "src/a.ts")).toBe("{}\n");
    const held = await conversationAssignment(first.leadAgentId);
    // The second conversation writes without a claim, as a formatter or `node -e` would.
    await writeFile(resolve(second.worktree, "src/a.ts"), "export const a = 2;\n");
    await writeFile(resolve(second.worktree, "src/b.ts"), "export const b = 1;\n");
    await writeFile(resolve(second.worktree, "debug.log"), "ignored\n");
    await mkdir(resolve(second.worktree, ".lervo/state"), { recursive: true });
    await writeFile(resolve(second.worktree, ".lervo/state/notes.json"), "{}\n");

    const answer = await stop(second.sessionId, second.worktree);
    expect(answer.decision).toBe("block");
    expect(answer.reason).toBe(
      `Lervo found changes in this turn that conflict with other work. \`src/a.ts\` is claimed by Arin (Developer) until ${localClockTime(held.lease!.expiresAt)} in "Log format". Two agents changing one path in parallel conflict when their work integrates. Do not write these paths another way. Mention @Arin with the change you need, or end your turn saying what waits on it. Lervo checks again when this turn ends: what still conflicts then stays unresolved, and sealing waits until it resolves.`,
    );
    expect(await changedPathsOf(second.workspaceId)).toEqual(["src/a.ts", "src/b.ts"]);
    expect((await conversationAssignment(second.leadAgentId)).expectedPaths).toEqual(["src/b.ts"]);
    expect(await eventsOf(app.repository, "assignment.lease.widened")).toMatchObject([
      { payload: { cause: "claim", expectedPathCount: 1 } },
      { payload: { cause: "reconcile", expectedPathCount: 1, addedPathCount: 1 } },
    ]);
    expect(await eventsOf(app.repository, "assignment.claim.refused")).toMatchObject([
      {
        payload: {
          code: "path_leased",
          holderAgentId: first.leadAgentId,
          holderWorkspaceId: first.workspaceId,
          detection: "reconcile",
        },
      },
    ]);
    expect(claimLogStates(second.sessionId)).toEqual([
      {
        decision: "deny",
        code: "path_leased",
        paths: ["src/a.ts"],
        toolUseId: null,
        state: "refused",
      },
    ]);

    // The second run lets the turn end, and what still conflicts becomes unresolved once.
    expect(await stop(second.sessionId, second.worktree, true)).toEqual({});
    expect(claimLogStates(second.sessionId)).toMatchObject([{ state: "unresolved" }]);
    expect(await eventsOf(app.repository, "assignment.claim.refused")).toHaveLength(1);

    // The first conversation's own changes never conflict with its claims.
    await writeFile(resolve(first.worktree, "src/a.ts"), "export const a = 3;\n");
    expect(await stop(first.sessionId, first.worktree)).toEqual({});
  });

  it("lets a turn end that conflicts with nothing, and claims nothing while the gate is closed", async () => {
    const { first, second } = app;
    vi.stubEnv("LERVO_COORDINATION", "0");
    await writeFile(resolve(second.worktree, "src/b.ts"), "export const b = 1;\n");
    expect(await stop(second.sessionId, second.worktree)).toEqual({});
    expect(await changedPathsOf(second.workspaceId)).toBeUndefined();
    expect((await conversationAssignment(second.leadAgentId)).expectedPaths).toEqual([]);

    vi.stubEnv("LERVO_COORDINATION", "1");
    expect(await stop(second.sessionId, second.worktree)).toEqual({});
    expect((await conversationAssignment(second.leadAgentId)).expectedPaths).toEqual(["src/b.ts"]);
    // A committed change still counts against the generation's base.
    await git(second.worktree, "add", "-A");
    await git(second.worktree, "commit", "-m", "b");
    expect(await stop(second.sessionId, second.worktree)).toEqual({});
    expect(await changedPathsOf(second.workspaceId)).toEqual(["src/b.ts"]);
    expect(await changedPathsOf(first.workspaceId)).toBeUndefined();
  });

  it("resolves a deferred claim once the turn's end claims its path", async () => {
    const { first } = app;
    widening.failure = new AgentWorkforceError("workforce_busy", "busy");
    expect(await write(first.sessionId, first.worktree, "src/e.ts")).toBe("{}\n");
    await writeFile(resolve(first.worktree, "src/e.ts"), "export const e = 1;\n");
    expect(claimLogStates(first.sessionId)).toMatchObject([
      { decision: "defer", code: "workforce_busy", paths: ["src/e.ts"], state: "deferred" },
    ]);
    expect(await stop(first.sessionId, first.worktree)).toEqual({});
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual(["src/e.ts"]);
    expect(claimLogStates(first.sessionId)).toMatchObject([{ state: "resolved" }]);
  });
});

describe("a conversation's lease over time", () => {
  it("keeps changed bytes holding after the lease expires, and the lead comes back to its lease", async () => {
    const { first, second } = app;
    await writeFile(resolve(first.worktree, "src/c.ts"), "export const c = 1;\n");
    expect(await stop(first.sessionId, first.worktree)).toEqual({});
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual(["src/c.ts"]);
    await setLeaseExpiry(first.leadAgentId, new Date(Date.now() - 60_000));

    // The lease no longer holds `src/c.ts`, but the first conversation's change does.
    const refused = JSON.parse(await write(second.sessionId, second.worktree, "src/c.ts")) as {
      hookSpecificOutput: { permissionDecisionReason: string };
    };
    expect(refused.hookSpecificOutput.permissionDecisionReason).toContain(
      "`src/c.ts` was changed by Arin (Developer), and that change is not sealed yet.",
    );

    // The lead's next claim reacquires its lease under the next generation and keeps its paths.
    expect(await write(first.sessionId, first.worktree, "src/d.ts")).toBe("{}\n");
    const regenerated = await conversationAssignment(first.leadAgentId);
    expect(regenerated.expectedPaths).toEqual(["src/c.ts", "src/d.ts"]);
    expect(regenerated.lease).toMatchObject({ generation: 2 });
    expect(Date.parse(regenerated.lease!.expiresAt)).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(await eventsOf(app.repository, "assignment.claimed")).toContainEqual(
      expect.objectContaining({ payload: expect.objectContaining({ generation: 2 }) }),
    );
  });

  it("renews the lease at the turn's end once less than 5 minutes remain", async () => {
    const { first } = app;
    await setLeaseExpiry(first.leadAgentId, new Date(Date.now() + 2 * 60_000));
    expect(await stop(first.sessionId, first.worktree)).toEqual({});
    const renewed = await conversationAssignment(first.leadAgentId);
    expect(Date.parse(renewed.lease!.expiresAt)).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(renewed.lease!.generation).toBe(1);
    expect(await eventsOf(app.repository, "assignment.lease.renewed")).toHaveLength(1);
  });

  it("reconciles a lead's exit, leaving what still conflicts unresolved", async () => {
    const { first, second } = app;
    expect(await write(first.sessionId, first.worktree, "src/a.ts")).toBe("{}\n");
    await writeFile(resolve(second.worktree, "src/a.ts"), "export const a = 2;\n");
    const exited = await reconcileExitedSession(second.sessionId);
    expect(exited.blockReason).toBeNull();
    expect(exited.reconciliation).toMatchObject({
      status: "reconciled",
      conflicts: [{ code: "path_leased", paths: ["src/a.ts"] }],
    });
    expect(await changedPathsOf(second.workspaceId)).toEqual(["src/a.ts"]);
    expect(claimLogStates(second.sessionId)).toMatchObject([
      { decision: "deny", paths: ["src/a.ts"], toolUseId: null, state: "unresolved" },
    ]);
    // A session no conversation launched reconciles nothing.
    expect(await reconcileExitedSession("unknown-session")).toEqual({
      blockReason: null,
      reconciliation: null,
    });
  });
});
