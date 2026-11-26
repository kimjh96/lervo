import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type HostedLaunchRecord, recordHostedLaunch } from "../src/hosted-launch-records.js";
import { parseTerminalHookIngress, parseTerminalHookInput } from "../src/terminal-hook-input.js";
import {
  answerPreToolUse,
  claimReading,
  type WriteClaimRequest,
  type WritingSession,
  writingSessionOf,
} from "../src/write-claims.js";

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

  it("finds the writing session from the launch record: the lead's, never a joined reader's", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lervo-claims-"));
    try {
      const path = join(directory, "hosted-launches.json");
      const record = (sessionId: string, extra: object) =>
        ({
          schemaVersion: 1,
          workspaceId: "wsp_1",
          sessionId,
          provider: "claude",
          projectId: "prj_1",
          branch: "lervo/x",
          conversationMode: "native",
          argumentDigest: `sha256:${"0".repeat(64)}`,
          settingsDigest: null,
          mcpConfigDigest: null,
          preparedAt: "2026-11-27T00:00:00.000Z",
          ...extra,
        }) as HostedLaunchRecord;
      await recordHostedLaunch(path, record("lead", { agentId: "agt_1" }));
      await recordHostedLaunch(path, record("reader", { agentId: "agt_2", access: "read" }));
      await recordHostedLaunch(path, record("plain", {}));
      expect(await writingSessionOf("lead", path)).toEqual(lead);
      expect(await writingSessionOf("reader", path)).toBeNull();
      expect(await writingSessionOf("plain", path)).toBeNull();
      expect(await writingSessionOf("unknown", path)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
