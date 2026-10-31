import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { RepositorySnapshotError } from "@lervo/orchestrator";

import { runTerminalHookCommand } from "../src/terminal-hook-command.js";
import { DisabledTerminalStageObservation } from "../src/terminal-stage-observation.js";
import { TERMINAL_HOOK_BUDGET_MS, TerminalHookFailure } from "../src/terminal-hook-budget.js";

const ports = vi.hoisted(() => ({
  prepare: vi.fn(),
  base: vi.fn(),
  record: vi.fn(),
  attach: vi.fn(),
  stop: vi.fn(),
  expectation: vi.fn(),
}));
vi.mock("../src/terminal-prompt-context.js", () => ({
  prepareTerminalPromptContext: ports.prepare,
}));
vi.mock("../src/terminal-degraded-context.js", async (original) => ({
  ...(await original<typeof import("../src/terminal-degraded-context.js")>()),
  prepareTerminalBaseContext: ports.base,
}));
vi.mock("@lervo/project-storage", () => ({
  openProjectStorage: async () => ({ close: async () => undefined }),
}));
vi.mock("../src/terminal-activation-state.js", () => ({
  writeTerminalActivationReceipt: async () => undefined,
}));
vi.mock("../src/terminal-instruction-capture.js", () => ({
  queueTerminalOwnerTurn: async () => false,
}));
vi.mock("../src/terminal-stage-persistence.js", () => ({
  recordTerminalStageObservation: ports.record,
}));
vi.mock("../src/terminal-repository-root.js", () => ({
  resolveTerminalRepositoryRoot: async () => "/repository",
}));
vi.mock("../src/terminal-workspace-lifecycle.js", async (original) => ({
  ...(await original<typeof import("../src/terminal-workspace-lifecycle.js")>()),
  attachTerminalWorkspace: ports.attach,
}));
vi.mock("../src/terminal-stop-hook.js", () => ({ completeTerminalHookTurn: ports.stop }));
vi.mock("../src/terminal-turn-observation.js", () => ({
  preparedTerminalTurnExpectation: ports.expectation,
  recordPreparedTerminalContext: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  ports.base.mockResolvedValue([
    "AGENTS.md pointer",
    "publication.language=en",
    "Applied owner rule: full clause",
    "Lervo workstream: recorded title (revision 3).",
  ]);
  ports.attach.mockResolvedValue(null);
  ports.record.mockResolvedValue("evt_observed");
  ports.expectation.mockResolvedValue({ observationId: "tobs_expected123" });
});
afterEach(() => vi.useRealTimers());

async function hook(provider: "codex" | "claude", event = "UserPromptSubmit") {
  const output: string[] = [];
  const projectSearchQueries = vi.fn().mockRejectedValue(new Error("must not call a provider"));
  const code = await runTerminalHookCommand(
    ["--provider", provider, "--contract", "2"],
    {
      cwd: "/repository",
      stdout: (value) => output.push(value),
      stderr: () => undefined,
      stdin: async () =>
        JSON.stringify({ hook_event_name: event, session_id: "session", prompt: "private prompt" }),
    },
    {
      createTerminalStageObservation: () => new DisabledTerminalStageObservation(),
      projectSearchQueries,
    },
  );
  expect(projectSearchQueries).not.toHaveBeenCalled();
  return { code, output: JSON.parse(output.join("")) };
}

describe.each(["codex", "claude"] as const)("%s hook failures", (provider) => {
  it.each([
    "repository_snapshot_limit_exceeded",
    "repository_snapshot_deadline_exceeded",
    "git_ignored_paths_unavailable",
    "repository_snapshot_failed",
  ] as const)("keeps base context and records %s without private diagnostics", async (reason) => {
    ports.prepare.mockRejectedValue(
      new RepositorySnapshotError("private/path and stack", undefined, reason),
    );
    const result = await hook(provider);
    expect(result.code).toBe(0);
    const context = result.output.hookSpecificOutput.additionalContext;
    for (const line of await ports.base.mock.results[0]!.value) expect(context).toContain(line);
    expect(context).toContain(`Lervo context degraded (${reason})`);
    expect(context).not.toContain("private/path");
    expect(ports.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", failureReason: reason }),
    );
  });

  it("does not compute base context after healthy prompt preparation", async () => {
    ports.prepare.mockResolvedValue({
      additionalContext: "Healthy prepared context",
      grounding: { queryProjectionReceipt: { receiptId: "qpr_prepared" } },
      documents: [],
    });
    const result = await hook(provider);
    expect(result.output.hookSpecificOutput.additionalContext).toBe("Healthy prepared context");
    expect(ports.base).not.toHaveBeenCalled();
  });

  it("names failed knowledge inspection and does not invent snapshot preparation evidence", async () => {
    ports.prepare.mockRejectedValue(new Error("private scan detail"));
    const result = await hook(provider);
    expect(result.output.hookSpecificOutput.additionalContext).toContain(
      "knowledge_inspection_failed",
    );
    expect(ports.record).toHaveBeenCalledTimes(1);
  });

  it("stops a hung preparation within the shared budget", async () => {
    vi.useFakeTimers();
    ports.prepare.mockImplementation(() => new Promise(() => undefined));
    const pending = hook(provider);
    await vi.advanceTimersByTimeAsync((TERMINAL_HOOK_BUDGET_MS * 2) / 3 + 1);
    const result = await pending;
    expect(result.output.hookSpecificOutput.additionalContext).toContain("hook_deadline_exceeded");
  });

  it.each([
    "repository_snapshot_limit_exceeded",
    "knowledge_inspection_failed",
    "event_persistence_failed",
  ] as const)("allows Stop after %s", async (reason) => {
    ports.stop.mockRejectedValue(new TerminalHookFailure(reason));
    const result = await hook(provider, "Stop");
    expect(result).toEqual({ code: 0, output: {} });
    expect(ports.record).toHaveBeenCalledWith(
      expect.objectContaining({
        hookEvent: "Stop",
        failureReason: reason,
        observationId: "tobs_expected123",
      }),
    );
  });

  it("records unmatched Stop lookup failure instead of silently losing it", async () => {
    ports.expectation.mockRejectedValue(new Error("private storage detail"));
    expect(await hook(provider, "Stop")).toEqual({ code: 0, output: {} });
    expect(ports.record).toHaveBeenCalledWith(
      expect.objectContaining({ failureReason: "lifecycle_inspection_failed" }),
    );
  });
});
