import { describe, expect, it } from "vitest";

import type { AgentWorkspace } from "@lervo/agent-workforce";

import {
  findClaimingConversation,
  type ClaimingConversationPorts,
} from "../src/claim-conversation.js";
import type { WriteClaimRequest, WritingSession } from "../src/claim-contract.js";
import type { HostedLaunchRecord } from "../src/hosted-launch-records.js";
import { parseTerminalHookIngress, parseTerminalHookInput } from "../src/terminal-hook-input.js";
import { terminalWriterSessionId } from "../src/terminal-workspace-boundary.js";
import { answerClaimHook, answerPreToolUse, claimReading } from "../src/write-claims.js";

const answering = claimReading("claude");

/** The refusal reason of an unverified claim's answer, or null for any other answer. */
function unverifiedReason(answer: string): string | null {
  const output = JSON.parse(answer) as {
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
  };
  const reason = output.hookSpecificOutput?.permissionDecisionReason ?? "";
  return output.hookSpecificOutput?.permissionDecision === "deny" &&
    reason.includes("could not check")
    ? reason
    : null;
}
const lead: WritingSession = { workspaceId: "wsp_1", agentId: "agt_1" };
const hook = (tool_name: string, tool_input: object) => {
  const parsed = parseTerminalHookIngress(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tool_name,
      tool_input,
      tool_use_id: "toolu_1",
      cwd: "/work/repo",
    }),
  );
  if (parsed.event !== "PreToolUse") throw new Error("not a pre-tool input");
  return parsed;
};

describe("claims at first write", () => {
  it("parses a pre-tool input and keeps it out of the prompt path", () => {
    expect(hook("Edit", { file_path: "a.ts" })).toEqual({
      event: "PreToolUse",
      providerSessionId: "s1",
      toolName: "Edit",
      toolInput: { file_path: "a.ts" },
      toolUseId: "toolu_1",
      workingDirectory: "/work/repo",
    });
    expect(() =>
      parseTerminalHookInput(
        JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", tool_name: "Edit" }),
      ),
    ).toThrow();
    expect(() =>
      parseTerminalHookIngress(
        JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", tool_name: "rm -rf" }),
      ),
    ).toThrow();
  });

  it("asks the claim for the writing session's write and speaks only to refuse", async () => {
    const asked: WriteClaimRequest[] = [];
    const answer = await answerPreToolUse({
      hook: hook("Write", { file_path: "src/a.ts", content: "x" }),
      answering,
      fallbackDirectory: "/elsewhere",
      writing: () => Promise.resolve(lead),
      claim: (request) => {
        asked.push(request);
        return Promise.resolve({
          decision: "deny",
          code: "path_leased",
          paths: ["src/a.ts"],
          holder: null,
          message: "Ciel holds src/a.ts.",
        });
      },
    });
    expect(asked).toEqual([
      {
        workspaceId: "wsp_1",
        agentId: "agt_1",
        providerSessionId: "s1",
        toolUseId: "toolu_1",
        intent: {
          toolClass: "file",
          targets: [{ path: "/work/repo/src/a.ts", kind: "file" }],
          detection: "exact",
        },
        session: lead,
        deadline: expect.any(Number),
        signal: expect.any(AbortSignal),
        lockTaken: expect.any(Function),
      },
    ]);
    expect(JSON.parse(answer).hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Ciel holds src/a.ts.",
    });
  });

  it("claims nothing outside a writing session, and reads no state for calls that write nothing", async () => {
    let claimed = 0;
    let looked = 0;
    const claim = () => {
      claimed += 1;
      return Promise.resolve({
        decision: "deny" as const,
        code: "path_leased",
        paths: ["a.ts"],
        holder: null,
        message: "no",
      });
    };
    const base = { answering, fallbackDirectory: "/work/repo", claim };
    expect(
      await answerPreToolUse({
        ...base,
        hook: hook("Edit", { file_path: "a.ts" }),
        writing: () => Promise.resolve(null),
      }),
    ).toBe("{}\n");
    expect(
      await answerPreToolUse({
        ...base,
        hook: hook("Bash", { command: "git status && ls" }),
        writing: () => {
          looked += 1;
          return Promise.resolve(lead);
        },
      }),
    ).toBe("{}\n");
    expect([claimed, looked]).toEqual([0, 0]);
  });

  it("refuses as unverified a claim that fails or takes too long, never letting it through", async () => {
    const base = {
      hook: hook("Edit", { file_path: "a.ts" }),
      answering,
      fallbackDirectory: "/",
      writing: () => Promise.resolve(lead),
    };
    expect(
      unverifiedReason(
        await answerPreToolUse({
          ...base,
          claim: () => Promise.reject(Object.assign(new Error("busy"), { code: "workforce_busy" })),
        }),
      ),
    ).toContain("(workforce_busy)");
    const started = performance.now();
    expect(
      await answerPreToolUse({
        ...base,
        decisionMs: 20,
        claim: () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  decision: "deny",
                  code: "path_leased",
                  paths: ["a.ts"],
                  holder: null,
                  message: "late",
                }),
              500,
            ),
          ),
      }),
    ).toMatch(/claim_deferred/u);
    expect(performance.now() - started).toBeLessThan(400);
  });

  it("finds the conversation from the lead's launch record, never a joined reader's", async () => {
    const conversation = `wsp_${"c".repeat(24)}`;
    const generation = (extra: Partial<AgentWorkspace>) =>
      ({
        workspaceId: `wsp_${"d".repeat(24)}`,
        kind: "conversation",
        conversationId: conversation,
        generation: 1,
        state: "ready",
        assignmentId: `asn_${"a".repeat(24)}`,
        agentId: "agt_1",
        pathDigest: `sha256:${"e".repeat(64)}`,
        ownerWorkspacePath: "/work/worktree",
        createdAt: "2026-11-27T00:00:00.000Z",
        ...extra,
      }) as AgentWorkspace;
    const launches = new Map<string, Partial<HostedLaunchRecord>>([
      ["lead", { workspaceId: conversation, projectId: "prj_1", agentId: "agt_1" }],
      [
        "reader",
        { workspaceId: conversation, projectId: "prj_1", agentId: "agt_2", access: "read" },
      ],
      ["agentless", { workspaceId: conversation, projectId: "prj_1" }],
    ]);
    const gated: string[] = [];
    const ports: ClaimingConversationPorts = {
      coordinationEnabled: (root) => {
        gated.push(root);
        return Promise.resolve(true);
      },
      launchOfSession: (session) =>
        Promise.resolve((launches.get(session) as HostedLaunchRecord | undefined) ?? null),
      registeredRoot: () => Promise.resolve("/work/repo"),
      terminalRoots: (cwd) =>
        Promise.resolve({ executionRoot: cwd, evidenceRoot: cwd, reason: "checkout" }),
      workspaces: () => Promise.resolve([generation({})]),
    };
    const find = (providerSessionId: string) =>
      findClaimingConversation(
        { provider: "claude", providerSessionId, workingDirectory: "/work/worktree" },
        ports,
      );
    expect(await find("lead")).toEqual({
      workspaceId: conversation,
      agentId: "agt_1",
      provider: "claude",
      repositoryRoot: "/work/repo",
      worktree: "/work/worktree",
      assignmentId: `asn_${"a".repeat(24)}`,
      writerSessionId: terminalWriterSessionId("claude", "lead"),
    });
    expect(gated).toEqual(["/work/repo"]);
    expect(await find("reader")).toBeNull();
    // A hosted launch without an agent claims nothing, as before; it never looks at the checkout.
    expect(await find("agentless")).toBeNull();
    // Without a launch record, a main checkout has no conversation, and no gate is read.
    expect(await find("owner")).toBeNull();
    expect(gated).toEqual(["/work/repo"]);
  });

  it("reads no workspace record while the repository's gate is closed", async () => {
    const read = () => {
      throw new Error("read state");
    };
    const answer = await answerClaimHook(hook("Write", { file_path: "src/a.ts" }), "claude", "/", {
      ports: {
        coordinationEnabled: () => Promise.resolve(false),
        launchOfSession: () =>
          Promise.resolve({
            workspaceId: "wsp_1",
            projectId: "prj_1",
            agentId: "agt_1",
          } as HostedLaunchRecord),
        registeredRoot: () => Promise.resolve("/work/repo"),
        terminalRoots: read,
        workspaces: read,
      },
    });
    expect(answer).toBe("{}\n");
  });

  it("lets a claim that took the lock finish, and stops one that had not when the hook answered", async () => {
    const base = {
      hook: hook("Edit", { file_path: "a.ts" }),
      answering,
      fallbackDirectory: "/",
      writing: () => Promise.resolve(lead),
      decisionMs: 20,
    };
    const tracked: Promise<unknown>[] = [];
    let finished = false;
    const locked = await answerPreToolUse({
      ...base,
      trackWork: (work) => tracked.push(work),
      claim: async (request) => {
        request.lockTaken();
        await new Promise((resolve) => setTimeout(resolve, 100));
        finished = true;
        return { decision: "allow" };
      },
    });
    // The hook answered at its deadline, and the work it holds settles once the claim finished.
    expect([unverifiedReason(locked) !== null, finished, tracked.length]).toEqual([true, false, 1]);
    await Promise.all(tracked);
    expect(finished).toBe(true);

    let aborted: unknown = null;
    const untracked: Promise<unknown>[] = [];
    await answerPreToolUse({
      ...base,
      trackWork: (work) => untracked.push(work),
      claim: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        aborted = request.signal.aborted;
        return { decision: "allow" };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect([aborted, untracked.length]).toEqual([true, 0]);
  });
});
