import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentWorkforceError,
  CONVERSATION_TASK_TYPE,
  listAssignments,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { ClaimLog, claimLogPath } from "../src/claim-log.js";
import { localClockTime } from "../src/claim-message.js";
import { terminalProviderSessionDigest } from "../src/terminal-event-coordinates.js";
import { runTerminalHookCommand } from "../src/terminal-hook-command.js";
import { parseTerminalHookIngress } from "../src/terminal-hook-input.js";
import { openTerminalTurn } from "../src/terminal-open-turns.js";
import { createTerminalStageObservation } from "../src/terminal-stage-observation.js";
import { answerClaimHook } from "../src/write-claims.js";
import {
  claimFixture,
  eventsOf,
  openGateByFile,
  type ClaimFixture,
} from "./conversation-claim-fixture.js";

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
      `Lervo stopped this write. \`src/a.ts\` is claimed by Arin (Developer) until ${localClockTime(held.lease!.expiresAt)}. Two agents changing one path in parallel conflict when their work integrates. Do not write this path another way. Mention @Arin with the change you need, continue with other paths, or try again after Arin's change is sealed. Arin works in the conversation "Log format".`,
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

  it("names the held file when a claimed directory contains it", async () => {
    const { first, second } = app;
    await write(first.sessionId, first.worktree, `${first.worktree}/docs/scratch/canary-a.md`);

    const answer = await answerClaimHook(
      preToolUse(second.sessionId, second.worktree, "Bash", { command: "rm -r docs/scratch" }),
      "claude",
      second.worktree,
    );
    expect(denial(answer)).toContain(
      "Lervo stopped this write. `docs/scratch/canary-a.md` (inside `docs/scratch`) is claimed by Arin (Developer) until ",
    );
    const log = ClaimLog.openExisting(claimLogPath())!;
    try {
      expect(log.ofToolUse(second.sessionId, "toolu_1")).toMatchObject({
        paths: ["docs/scratch"],
        heldPaths: ["docs/scratch/canary-a.md"],
        holder: { agentId: first.leadAgentId },
      });
    } finally {
      log.close();
    }
  });

  it("names the held directory when it contains the claimed file", async () => {
    const { first, second } = app;
    await answerClaimHook(
      preToolUse(first.sessionId, first.worktree, "Bash", { command: "rm -r docs/scratch" }),
      "claude",
      first.worktree,
    );
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([
      "docs/scratch",
    ]);

    const answer = await write(
      second.sessionId,
      second.worktree,
      `${second.worktree}/docs/scratch/new.md`,
    );
    expect(denial(answer)).toContain(
      "Lervo stopped this write. `docs/scratch` (which contains `docs/scratch/new.md`) is claimed by Arin (Developer) until ",
    );
    expect(claimLogEntries(second.sessionId)).toMatchObject([
      { paths: ["docs/scratch/new.md"], heldPaths: ["docs/scratch"] },
    ]);
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

    // Two holders refuse one shell write: the log keeps both, the named one last, and the turn
    // records one event per holder however often the write is retried.
    const third = await app.startConversation("Cache layer", "Noa");
    await write(third.sessionId, third.worktree, `${third.worktree}/src/c.ts`);
    for (const toolUseId of ["toolu_3", "toolu_4"]) {
      const answer = await answerClaimHook(
        preToolUse(
          second.sessionId,
          second.worktree,
          "Bash",
          { command: "touch src/a.ts src/c.ts" },
          toolUseId,
        ),
        "claude",
        second.worktree,
      );
      expect(denial(answer)).toContain("`src/a.ts` is claimed by Arin");
    }
    expect(
      (await eventsOf(app.repository, "assignment.claim.refused")).map(
        (event) => (event.payload as { holderAgentId: string }).holderAgentId,
      ),
    ).toEqual([first.leadAgentId, third.leadAgentId]);
    const log = ClaimLog.openExisting(claimLogPath())!;
    try {
      expect(log.ofToolUse(second.sessionId, "toolu_4")).toMatchObject({
        paths: ["src/a.ts"],
        holder: { agentId: first.leadAgentId },
      });
    } finally {
      log.close();
    }
    expect(claimLogEntries(second.sessionId)).toHaveLength(6);
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

    // A link in the worktree to a file not yet written in the main checkout is judged by its target.
    await symlink(`${app.repository}/src/new.ts`, resolve(first.worktree, "linked.ts"));
    expect(
      denial(await write(first.sessionId, first.worktree, `${first.worktree}/linked.ts`)),
    ).toMatch(/^Lervo stopped this write\. `src\/new\.ts` is in another checkout/u);
  });

  it("allows a write to another checkout's ignored or runtime paths, which claim nothing", async () => {
    const { first } = app;
    for (const path of [
      `${app.repository}/debug.log`,
      `${app.repository}/.lervo/state/notes.json`,
      `${app.repository}/.git/info/exclude`,
    ])
      expect(await write(first.sessionId, first.worktree, path)).toBe("{}\n");
    expect(await eventsOf(app.repository, "assignment.claim.refused")).toEqual([]);
    expect(widening.calls).toBe(0);
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

  it("claims nothing for a command that only redirects to a descriptor", async () => {
    const { first } = app;
    const answer = await answerClaimHook(
      preToolUse(first.sessionId, first.worktree, "Bash", { command: "pnpm test 2>&1 | tail" }),
      "claude",
      first.worktree,
    );
    expect(answer).toBe("{}\n");
    expect(widening.calls).toBe(0);
    expect(claimLogEntries(first.sessionId)).toEqual([]);
    expect(await eventsOf(app.repository, "assignment.claim.refused")).toEqual([]);
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([]);
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

  it("defers as workforce_busy when another writer holds the event store", async () => {
    const { first } = app;
    const storage = await openProjectStorage(app.repository);
    const path = storage.paths.eventDatabase;
    await storage.close();
    const writer = new DatabaseSync(path);
    writer.exec("BEGIN IMMEDIATE");
    try {
      const started = performance.now();
      expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`)).toBe(
        "{}\n",
      );
      expect(performance.now() - started).toBeLessThan(1_500);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
    expect(claimLogEntries(first.sessionId)).toMatchObject([
      { decision: "defer", code: "workforce_busy", paths: ["src/a.ts"] },
    ]);
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual([]);
  });

  it("keeps the hook for a claim under the lock and shows it to the server's drain", async () => {
    const { first } = app;
    const tracked: Promise<unknown>[] = [];
    const hook = async (path: string) => {
      const stdout: string[] = [];
      const exitCode = await runTerminalHookCommand(
        ["--provider", "claude", "--contract", "2", "--claim"],
        {
          cwd: first.worktree,
          stdout: (message) => stdout.push(message),
          stderr: () => undefined,
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "PreToolUse",
              session_id: first.sessionId,
              tool_name: "Write",
              tool_input: { file_path: path, content: "x" },
              tool_use_id: "toolu_1",
              cwd: first.worktree,
            }),
        },
        {
          createTerminalStageObservation: (digest) =>
            Object.assign(createTerminalStageObservation(digest), {
              trackWork: (work: Promise<unknown>) => tracked.push(work),
            }),
        },
      );
      return { exitCode, stdout: stdout.join("") };
    };
    expect(await hook(`${first.worktree}/src/a.ts`)).toEqual({ exitCode: 0, stdout: "{}\n" });
    const widened = tracked.length;
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual(["src/a.ts"]);
    // A claim inside the lease takes no lock: it tracks one piece of work fewer, its stage's own.
    await hook(`${first.worktree}/src/a.ts`);
    expect(tracked.length - widened).toBe(widened - 1);
    await Promise.all(tracked);
  });

  it("opens the gate from the repository's file alone, for the start and for claims", async () => {
    const { first } = app;
    vi.stubEnv("LERVO_COORDINATION", "0");
    expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`)).toBe("{}\n");
    expect(widening.calls).toBe(0);

    const gate = await openGateByFile(app.repository);
    expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/a.ts`)).toBe("{}\n");
    expect((await conversationAssignment(first.leadAgentId)).expectedPaths).toEqual(["src/a.ts"]);
    expect((await app.startConversation("Gate by file", "Oda")).workspaceId).toMatch(/^wsp_/u);

    // A file others can read or write opens nothing.
    await chmod(gate, 0o644);
    expect(await write(first.sessionId, first.worktree, `${first.worktree}/src/z.ts`)).toBe("{}\n");
    expect(widening.calls).toBe(1);
  });
});
