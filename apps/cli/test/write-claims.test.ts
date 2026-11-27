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

  it("defers when the claim fails or takes too long, so the write goes ahead", async () => {
    const base = {
      hook: hook("Edit", { file_path: "a.ts" }),
      answering,
      fallbackDirectory: "/",
      writing: () => Promise.resolve(lead),
    };
    expect(
      await answerPreToolUse({ ...base, claim: () => Promise.reject(new Error("busy")) }),
    ).toBe("{}\n");
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
    ).toBe("{}\n");
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
    ]);
    const ports: ClaimingConversationPorts = {
      coordinationEnabled: () => true,
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
    expect(await find("reader")).toBeNull();
    // Without a launch record, a main checkout has no conversation.
    expect(await find("owner")).toBeNull();
    expect(
      await findClaimingConversation(
        { provider: "claude", providerSessionId: "lead", workingDirectory: "/work/worktree" },
        { ...ports, coordinationEnabled: () => false },
      ),
    ).toBeNull();
  });

  it("reads no state and allows every write while the coordination gate is closed", async () => {
    const read = () => {
      throw new Error("read state");
    };
    const answer = await answerClaimHook(hook("Write", { file_path: "src/a.ts" }), "claude", "/", {
      coordinationEnabled: () => false,
      launchOfSession: read,
      registeredRoot: read,
      terminalRoots: read,
      workspaces: read,
    });
    expect(answer).toBe("{}\n");
  });
});
