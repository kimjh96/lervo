import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HostedDecodedEvent } from "@lervo/adapter-contract";
import { afterEach, describe, expect, it } from "vitest";

import { ClaimLines } from "../src/claim-lines.js";
import {
  CLAIM_LOG_ENTRIES_PER_CONVERSATION,
  ClaimLog,
  type NewClaimLogEntry,
} from "../src/claim-log.js";
import { withoutShellOutput } from "../src/lervo-command-detail.js";
import { parseTerminalHookIngress } from "../src/terminal-hook-input.js";
import type { ClaimDecision } from "../src/claim-contract.js";
import { answerPreToolUse, claimReading } from "../src/write-claims.js";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function folder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "lervo-claim-log-"));
  folders.push(made);
  return made;
}

const refusal: NewClaimLogEntry = {
  workspaceId: "wsp_b",
  sessionId: "s1",
  toolUseId: "toolu_1",
  decision: "deny",
  code: "path_leased",
  paths: ["src/a.ts"],
  holder: { agentId: "agt_arin", workspaceId: "wsp_a" },
};

describe("the claim log", () => {
  it("keeps refusals and deferrals owner-only, finds a call's entry, and keeps the newest", async () => {
    const path = join(await folder(), "state", "claim-log.sqlite");
    const log = await ClaimLog.open(path);
    try {
      const refused = log.record(refusal, new Date("2026-11-27T01:00:00Z"));
      expect(refused).toMatchObject({ state: "refused", claimId: expect.stringMatching(/^clm_/u) });
      expect(log.ofToolUse("s1", "toolu_1")).toEqual(refused);
      expect(log.ofToolUse("s1", "toolu_2")).toBeNull();
      log.record(
        {
          ...refusal,
          toolUseId: "toolu_2",
          decision: "defer",
          code: "workforce_busy",
          holder: null,
        },
        new Date("2026-11-27T01:00:05Z"),
      );
      expect(log.deferredSince("s1", "2026-11-27T01:00:00Z").map((entry) => entry.code)).toEqual([
        "workforce_busy",
      ]);
      expect(log.deferredSince("s1", "2026-11-27T01:00:05Z")).toEqual([]);
      expect(log.refusedSince("s1", "2026-11-27T00:59:59Z")).toEqual([refused]);
      expect(log.refusedSince("s1", "2026-11-27T01:00:00Z")).toEqual([]);
      for (let index = 0; index < CLAIM_LOG_ENTRIES_PER_CONVERSATION; index += 1)
        log.record(
          { ...refusal, toolUseId: `toolu_n${index}` },
          new Date(Date.parse("2026-11-27T02:00:00Z") + index * 1000),
        );
      // The conversation keeps its newest entries; the first refusal went first.
      expect(log.ofToolUse("s1", "toolu_1")).toBeNull();
      expect(
        log.ofToolUse("s1", `toolu_n${CLAIM_LOG_ENTRIES_PER_CONVERSATION - 1}`),
      ).not.toBeNull();
    } finally {
      log.close();
    }
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("moves a claim to the state reconciliation decides, idempotently", async () => {
    const log = await ClaimLog.open(join(await folder(), "claim-log.sqlite"));
    try {
      const { claimId } = log.record(refusal, new Date("2026-11-27T01:00:00Z"));
      expect(log.updateState(claimId, "resolved", new Date("2026-11-27T02:00:00Z"))).toBe(true);
      expect(log.updateState(claimId, "resolved", new Date("2026-11-27T03:00:00Z"))).toBe(true);
      expect(log.ofToolUse("s1", "toolu_1")).toMatchObject({
        state: "resolved",
        updatedAt: "2026-11-27T02:00:00.000Z",
      });
      expect(log.updateState("clm_unknown", "resolved")).toBe(false);
    } finally {
      log.close();
    }
  });

  it("lists a conversation's unresolved claims, oldest first, and none once resolved", async () => {
    const log = await ClaimLog.open(join(await folder(), "claim-log.sqlite"));
    try {
      const first = log.record(refusal, new Date("2026-11-27T01:00:00Z"));
      const second = log.record(
        { ...refusal, toolUseId: "toolu_2" },
        new Date("2026-11-27T01:00:01Z"),
      );
      log.record({ ...refusal, workspaceId: "wsp_c", toolUseId: "toolu_3" });
      expect(log.unresolvedOf("wsp_b")).toEqual([]);
      log.updateState(second.claimId, "unresolved", new Date("2026-11-27T02:00:00Z"));
      log.updateState(first.claimId, "unresolved", new Date("2026-11-27T02:00:01Z"));
      expect(log.unresolvedOf("wsp_b").map((entry) => entry.claimId)).toEqual([
        first.claimId,
        second.claimId,
      ]);
      expect(log.unresolvedOf("wsp_c")).toEqual([]);
      log.updateState(first.claimId, "resolved");
      expect(log.unresolvedOf("wsp_b").map((entry) => entry.claimId)).toEqual([second.claimId]);
    } finally {
      log.close();
    }
  });

  it("is read only once it exists", async () => {
    expect(ClaimLog.openExisting(join(await folder(), "claim-log.sqlite"))).toBeNull();
  });
});

describe("recording claims from the pre-tool hook", () => {
  const hook = (cwd: string, toolInput: object) => {
    const parsed = parseTerminalHookIngress(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        tool_name: "Write",
        tool_input: toolInput,
        tool_use_id: "toolu_1",
        cwd,
      }),
    );
    if (parsed.event !== "PreToolUse") throw new Error("not a pre-tool input");
    return parsed;
  };
  const answer = async (cwd: string, decision: ClaimDecision | "late") => {
    const recorded: NewClaimLogEntry[] = [];
    await answerPreToolUse({
      hook: hook(cwd, { file_path: "src/a.ts", content: "x" }),
      answering: claimReading("claude"),
      fallbackDirectory: cwd,
      writing: async () => ({ workspaceId: "wsp_b", agentId: "agt_ciel" }),
      claim: () => (decision === "late" ? new Promise(() => undefined) : Promise.resolve(decision)),
      record: async (entry) => void recorded.push(entry),
      decisionMs: 20,
    });
    return recorded;
  };

  it("records a refusal with the core's paths and holder, and nothing for an allowed write", async () => {
    const worktree = await folder();
    expect(
      await answer(worktree, {
        decision: "deny",
        code: "path_leased",
        paths: ["src/a.ts"],
        holder: {
          agentId: "agt_arin",
          displayName: "Arin",
          roleName: "Developer",
          origin: "team",
          workspaceId: "wsp_a",
          conversationTitle: "Log format",
          kind: "lease",
          until: null,
        },
        message: "Arin holds src/a.ts.",
      }),
    ).toEqual([
      { ...refusal, sessionId: "s1", holder: { agentId: "agt_arin", workspaceId: "wsp_a" } },
    ]);
    expect(await answer(worktree, { decision: "allow" })).toEqual([]);
  });

  it("records a deferral with the paths relative to the worktree, and Lervo's own when late", async () => {
    const worktree = await folder();
    await mkdir(join(worktree, ".git"));
    await mkdir(join(worktree, "src"));
    const cwd = join(worktree, "src");
    expect(await answer(cwd, { decision: "defer", code: "workforce_busy" })).toEqual([
      expect.objectContaining({
        decision: "defer",
        code: "workforce_busy",
        paths: ["src/src/a.ts"],
      }),
    ]);
    expect(await answer(worktree, "late")).toEqual([
      expect.objectContaining({ decision: "defer", code: "claim_deferred", paths: ["src/a.ts"] }),
    ]);
  });
});

describe("the claim lines in a conversation", () => {
  const tool = (status: "failed" | "succeeded", toolUseId: string): HostedDecodedEvent => ({
    kind: "item",
    content: { kind: "tool_activity", name: "Edit", status, calls: 1, toolUseId },
    createdAtMs: 1,
  });
  const finished: HostedDecodedEvent = { kind: "status", event: "turn_finished" };
  const names = (agentId: string) => ({ agt_ciel: "Ciel", agt_arin: "Arin" })[agentId] ?? null;

  it("says who holds a stopped call's path, and once a turn that its claims wait for its end", async () => {
    const log = await ClaimLog.open(join(await folder(), "claim-log.sqlite"));
    let now = new Date("2026-11-27T01:00:00Z");
    const lines = new ClaimLines(
      () => log,
      () => now,
    );
    try {
      lines.annotate("s1", "agt_ciel", [], names);
      log.record(refusal, new Date("2026-11-27T01:00:01Z"));
      log.record(
        {
          ...refusal,
          toolUseId: "toolu_2",
          decision: "defer",
          code: "workforce_busy",
          holder: null,
        },
        new Date("2026-11-27T01:00:02Z"),
      );
      log.record(
        {
          ...refusal,
          toolUseId: "toolu_3",
          decision: "defer",
          code: "claim_deferred",
          holder: null,
        },
        new Date("2026-11-27T01:00:03Z"),
      );
      now = new Date("2026-11-27T01:00:04Z");
      const shown = lines.annotate(
        "s1",
        "agt_ciel",
        [tool("failed", "toolu_1"), tool("succeeded", "toolu_2"), finished],
        names,
      );
      expect(shown.map((event) => (event.kind === "item" ? event.content : event))).toEqual([
        expect.objectContaining({ kind: "tool_activity", toolUseId: "toolu_1" }),
        {
          kind: "lervo_notice",
          code: "claim_conflict",
          parameters: {
            agent: "Ciel",
            path: "src/a.ts",
            code: "path_leased",
            holder: "Arin",
            workspace: "wsp_a",
          },
        },
        expect.objectContaining({ kind: "tool_activity", toolUseId: "toolu_2" }),
        { kind: "lervo_notice", code: "claim_deferred", parameters: { code: "workforce_busy" } },
        finished,
      ]);
      // The next turn starts clean.
      expect(lines.annotate("s1", "agt_ciel", [finished], names)).toEqual([finished]);
    } finally {
      log.close();
    }
  });

  it("adds nothing without a log, and the session host never receives a call's ID", () => {
    const lines = new ClaimLines(() => null);
    const events = [tool("failed", "toolu_1"), finished];
    expect(lines.annotate("s1", "agt_ciel", events, names)).toEqual(events);
    const sent = withoutShellOutput({
      kind: "tool_activity",
      name: "Bash",
      status: "succeeded",
      calls: 1,
      output: "ok",
      toolUseId: "toolu_1",
    });
    expect(sent).toEqual({ kind: "tool_activity", name: "Bash", status: "succeeded", calls: 1 });
  });
});
