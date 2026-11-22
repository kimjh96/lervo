import { createClaudeHostedSessionAdapter } from "@lervo/adapter-claude";
import { createCodexHostedSessionAdapter } from "@lervo/adapter-codex";
import { describe, expect, it } from "vitest";

import { CommandFailure } from "../src/command-error-output.js";
import type { HostedLaunchRecord } from "../src/hosted-launch-records.js";
import {
  branchFor,
  objectiveFor,
  startWorkspace,
  titleFor,
  type WorkspaceStartPorts,
  workspacePathFor,
} from "../src/workspace-start.js";

const request = {
  instruction: "Fix the flaky login test\nIt fails on CI about once a day.",
  mode: "native" as const,
  repositoryRoot: "/work/lervo",
  projectId: "prj_0123456789abcdef",
  baseCommit: "a".repeat(40),
  workspaceId: "wsp_0123456789abcdef01234567",
  sessionId: "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c",
  suffix: "1a2b3c",
};

function ports(fail?: "workspace" | "workstream" | "record" | "undo") {
  const effects: string[] = [];
  const records: HostedLaunchRecord[] = [];
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
    now: () => new Date("2026-11-23T00:00:00.000Z"),
  };
  return { value, effects, records };
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
    expect(workspacePathFor("/work/lervo", "lervo/fix-1a2b3c")).toBe("/work/lervo-wt/fix-1a2b3c");
  });
});

describe("workspace start", () => {
  it("creates the workspace and workstream, then prepares and records the launch", async () => {
    const fake = ports();
    const result = await startWorkspace(request, fake.value);
    expect(fake.effects).toEqual([
      "provision lervo/fix-the-flaky-login-test-1a2b3c at /work/lervo-wt/fix-the-flaky-login-test-1a2b3c",
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
    const codex = { ...fake.value, adapter: createCodexHostedSessionAdapter("/opt/codex") };
    const error = await failure(startWorkspace(request, codex));
    expect(error.code).toBe("conversation_mode_unsupported");
    expect(fake.effects).toEqual([]);
  });
});
