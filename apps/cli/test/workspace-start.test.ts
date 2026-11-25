import { createClaudeHostedSessionAdapter } from "@lervo/adapter-claude";
import { createCodexHostedSessionAdapter } from "@lervo/adapter-codex";
import { workspaceStartBaseSchema } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandFailure } from "../src/command-error-output.js";
import type { HostedLaunchRecord } from "../src/hosted-launch-records.js";
import type { HostedSessionEvent } from "../src/hosted-session-events.js";
import { WORKSPACE_BASE_NOTICES, type WorkspaceBase } from "../src/workspace-base.js";
import {
  branchFor,
  objectiveFor,
  startWorkspace,
  titleFor,
  type WorkspacePlacement,
  type WorkspaceStartPorts,
  workspacePathFor,
} from "../src/workspace-start.js";

beforeEach(() => {
  vi.stubEnv("LERVO_WORKSPACES_HOME", "/lervo/workspaces");
});

const request = {
  instruction: "Fix the flaky login test\nIt fails on CI about once a day.",
  mode: "native" as const,
  repositoryRoot: "/work/lervo",
  projectId: "prj_0123456789abcdef",
  baseCommit: "a".repeat(40),
  workspaceId: "wsp_0123456789abcdef01234567",
  sessionId: "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c",
  suffix: "1a2b3c",
  hooks: {
    settingsPath: "/state/hosted-settings/0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c.json",
    command: "lervo workspace hook --provider claude",
  },
};

function ports(fail?: "workspace" | "workstream" | "record" | "undo") {
  const effects: string[] = [];
  const records: HostedLaunchRecord[] = [];
  const settings: { path: string; content: string }[] = [];
  const events: HostedSessionEvent[] = [];
  const value: WorkspaceStartPorts = {
    adapter: createClaudeHostedSessionAdapter("/opt/claude"),
    async provisionWorkspace(placement) {
      effects.push(`provision ${placement.branch} at ${placement.workspacePath}`);
      if (fail === "workspace")
        throw Object.assign(new Error("git failed"), { code: "host_git_failed" });
    },
    async removeWorkspace(placement) {
      effects.push(`remove ${placement.branch}`);
      if (fail === "undo") throw new Error("still there");
    },
    async startWorkstream(input) {
      effects.push(`workstream ${input.title}`);
      if (fail === "workstream" || fail === "undo") throw new Error("workstream failed");
      return "wks_0123456789abcdef01234567";
    },
    async recordLaunch(record) {
      if (fail === "record") throw new Error("disk full");
      records.push(record);
    },
    async writeSettings(file) {
      settings.push(file);
    },
    async recordEvents(recorded) {
      events.push(...recorded);
      return "recorded";
    },
    now: () => new Date("2026-11-23T00:00:00.000Z"),
  };
  return { value, effects, records, settings, events };
}

async function failure(run: Promise<unknown>): Promise<CommandFailure> {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CommandFailure);
  return error as CommandFailure;
}

describe("workspace names", () => {
  it("derives the title, objective, branch, and path from the instruction", () => {
    expect(titleFor("  Fix   the build \n details")).toBe("Fix the build");
    expect([...titleFor("word ".repeat(40))].length).toBeLessThanOrEqual(80);
    expect(objectiveFor("x".repeat(9000)).length).toBe(8192);
    expect(branchFor("Fix the flaky login test!", "1a2b3c")).toBe(
      "lervo/fix-the-flaky-login-test-1a2b3c",
    );
    expect(branchFor("로그인 테스트 고쳐줘", "1a2b3c")).toBe("lervo/work-1a2b3c");
    expect(branchFor("a ".repeat(40) + "z".repeat(50), "1a2b3c").length).toBeLessThan(60);
    expect(workspacePathFor("/work/lervo", "lervo/fix-1a2b3c", "/home/me/lervo/workspaces")).toBe(
      "/home/me/lervo/workspaces/lervo/fix-1a2b3c",
    );
  });
});

describe("workspace start", () => {
  it("creates the workspace and workstream, then prepares and records the launch", async () => {
    const fake = ports();
    const result = await startWorkspace(request, fake.value);
    expect(fake.effects).toEqual([
      "provision lervo/fix-the-flaky-login-test-1a2b3c at /lervo/workspaces/lervo/fix-the-flaky-login-test-1a2b3c",
      "workstream Fix the flaky login test",
    ]);
    expect(result).toMatchObject({
      status: "started",
      workstreamId: "wks_0123456789abcdef01234567",
      branch: "lervo/fix-the-flaky-login-test-1a2b3c",
      provider: "claude",
      launch: { mode: "native", initialInput: request.instruction },
    });
    expect(fake.records).toHaveLength(1);
    // The record names the branch, which Git already shows, but never holds the instruction.
    expect(JSON.stringify(fake.records)).not.toContain("once a day");
    expect(fake.records[0]?.argumentDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("writes the session's settings file, digests it, and records two events", async () => {
    const fake = ports();
    const result = await startWorkspace(request, fake.value);
    expect(fake.settings.map((file) => file.path)).toEqual([request.hooks.settingsPath]);
    expect(result.launch.arguments).toContain(request.hooks.settingsPath);
    expect(fake.records[0]?.settingsDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(fake.events.map((event) => event.type)).toEqual([
      "application.workspace.started",
      "terminal.session.launch_prepared",
    ]);
    const payloads = JSON.stringify(fake.events);
    expect(payloads).not.toContain(request.sessionId);
    expect(payloads).not.toContain("once a day");
    expect(fake.events[1]?.payload).toMatchObject({
      provider: "claude",
      conversationMode: "native",
      workspaceId: request.workspaceId,
    });
    expect(result.hostedEvents).toBe("recorded");
  });

  it("records no events before the launch exists", async () => {
    const fake = ports("record");
    await failure(startWorkspace(request, fake.value));
    expect(fake.events).toEqual([]);
  });

  it.each([
    ["workspace", "workspace"],
    ["workstream", "workstream"],
    ["record", "launch"],
  ] as const)("undoes every stage when the %s step fails", async (step, stage) => {
    const fake = ports(step);
    const error = await failure(startWorkspace(request, fake.value));
    expect(error.code).toBe("workspace_start_failed");
    expect(error.details).toMatchObject({ stage, rolledBack: true });
    expect(fake.effects.at(-1)).toBe("remove lervo/fix-the-flaky-login-test-1a2b3c");
  });

  it("reports a rollback that did not finish", async () => {
    const error = await failure(startWorkspace(request, ports("undo").value));
    expect(error.details).toMatchObject({ stage: "workstream", rolledBack: false });
  });

  it("refuses a conversation mode the provider lacks before changing anything", async () => {
    const fake = ports();
    let chosen = false;
    const codex = {
      ...fake.value,
      adapter: createCodexHostedSessionAdapter("/opt/codex"),
      chooseBase: async () => {
        chosen = true;
        return base;
      },
    };
    const error = await failure(startWorkspace(request, codex));
    expect(error.code).toBe("conversation_mode_unsupported");
    expect(fake.effects).toEqual([]);
    expect(chosen).toBe(false);
  });

  it("starts from the chosen base, replays its commits, and records what happened", async () => {
    const fake = ports();
    const placements: WorkspacePlacement[] = [];
    const result = await startWorkspace(request, {
      ...fake.value,
      chooseBase: async () => base,
      async replayEffects(placement) {
        placements.push(placement);
        return {
          replayed: ["e".repeat(40), "f".repeat(40)],
          skipped: [],
          carried: [],
          complete: true,
        };
      },
    });
    expect(placements[0]).toMatchObject({ baseCommit: base.commit, replay: base.replay });
    expect(fake.records[0]?.base).toEqual({
      commit: base.commit,
      source: "upstream",
      upstream: "origin/main",
      replayed: ["e".repeat(40), "f".repeat(40)],
      skipped: [],
      carried: [],
      notice: null,
    });
    expect(result.base).toEqual({
      source: "upstream",
      upstream: "origin/main",
      notice: null,
      replayed: 2,
      skipped: 0,
      carried: 0,
    });
  });

  it("says when it dropped the replay", async () => {
    const fake = ports();
    const result = await startWorkspace(request, {
      ...fake.value,
      chooseBase: async () => base,
      replayEffects: async () => ({
        replayed: [],
        skipped: [...base.replay],
        carried: [],
        complete: false,
      }),
    });
    expect(fake.records[0]?.base?.notice).toBe("replay_incomplete");
    expect(result.base).toMatchObject({ notice: "replay_incomplete", replayed: 0, skipped: 2 });
  });
});

describe("a worktree without project hooks", () => {
  it("launches with Lervo's terminal hooks for the events its project lacks", async () => {
    const fake = ports();
    const asked: string[] = [];
    await startWorkspace(request, {
      ...fake.value,
      async terminalHooks(workspacePath) {
        asked.push(workspacePath);
        return { command: "lervo terminal hook --provider claude --contract 2", events: ["Stop"] };
      },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.endsWith("/fix-the-flaky-login-test-1a2b3c")).toBe(true);
    const settings = JSON.parse(fake.settings[0]?.content ?? "{}") as {
      hooks: Record<string, unknown[]>;
    };
    expect(Object.keys(settings.hooks)).toEqual(["SessionStart", "SessionEnd", "Stop"]);
  });
});

describe("the base's notices", () => {
  it("all fit the session-host contract, which stays open to notices a later CLI adds", () => {
    const [string] = workspaceStartBaseSchema.properties.notice.anyOf;
    const pattern = new RegExp(string.pattern, "u");
    for (const notice of [...WORKSPACE_BASE_NOTICES, "replay_incomplete"])
      expect(pattern.test(notice), notice).toBe(true);
  });
});

describe("a base that cannot be chosen", () => {
  it("starts from the request's base commit and says why", async () => {
    const fake = ports();
    await startWorkspace(request, {
      ...fake.value,
      chooseBase: (fallback) => Promise.reject(new Error(`no default branch for ${fallback}`)),
    });
    expect(fake.records[0]?.base).toMatchObject({
      commit: request.baseCommit,
      source: "local",
      notice: "base_unresolved",
    });
  });
});

const base: WorkspaceBase = {
  commit: "b".repeat(40),
  source: "upstream",
  upstream: "origin/main",
  replay: ["e".repeat(40), "f".repeat(40)],
  notice: null,
};
