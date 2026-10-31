import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeTerminalHookTurn } from "../src/terminal-stop-hook.js";
import { DisabledTerminalStageObservation } from "../src/terminal-stage-observation.js";
import { budgetTerminalStages } from "../src/terminal-hook-budget.js";

const ports = vi.hoisted(() => ({
  inspect: vi.fn(),
  checkpoint: vi.fn(),
  pause: vi.fn(),
  record: vi.fn(),
  stages: vi.fn(),
  receipt: vi.fn(),
  capture: vi.fn(),
  launch: vi.fn(),
}));
vi.mock("../src/terminal-lifecycle-inspection.js", () => ({
  inspectTerminalLifecycle: ports.inspect,
}));
vi.mock("../src/terminal-workspace-lifecycle.js", () => ({
  checkpointTerminalWorkspace: ports.checkpoint,
  pauseTerminalWorkspace: ports.pause,
}));
vi.mock("../src/terminal-turn-observation.js", () => ({
  recordObservedTerminalTurn: ports.record,
}));
vi.mock("../src/terminal-stage-persistence.js", () => ({
  recordTerminalStageObservation: ports.stages,
}));
vi.mock("../src/terminal-activation-state.js", () => ({
  writeTerminalActivationReceipt: ports.receipt,
}));
vi.mock("../src/terminal-instruction-capture.js", () => ({
  settleTerminalAgentTurn: ports.capture,
}));
vi.mock("../src/detached-knowledge-worker.js", () => ({
  launchDetachedKnowledgeWorker: ports.launch,
}));
// No bound worker entry: only the prefetch launch is observable here.
vi.mock("../src/terminal-worker-entry.js", () => ({
  terminalWorkerEntry: async () => null,
}));
vi.mock("@lervo/repository-context", () => ({
  observeHostContextOutcomes: async () => undefined,
  hostOutcomeTask: () => ({}),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LERVO_TERMINAL_HOOK_RUNTIME", undefined);
  vi.stubEnv("LERVO_TERMINAL_CONTEXT", undefined);
  ports.capture.mockResolvedValue({ capturePending: false });
  ports.checkpoint.mockResolvedValue({ eventId: "evt_checkpoint" });
  ports.launch.mockResolvedValue(true);
  ports.inspect.mockResolvedValue({ status: "current", issues: [], workspace: {} });
  ports.record.mockResolvedValue({
    eventId: "evt_turn",
    changedPaths: [],
    referenceCount: 0,
    knowledgeJobQueued: false,
  });
});
afterEach(() => vi.unstubAllEnvs());
function invoke(worker = true) {
  const output: string[] = [];
  const input: Parameters<typeof completeTerminalHookTurn>[0] = {
    root: "/repository",
    provider: "claude" as const,
    contractId: "lervo_terminal_hooks_v2" as const,
    coordinates: {
      runId: "run_private",
      sessionId: "ses_private",
      providerSessionDigest: "sha256:opaque",
      providerTurnDigest: null,
    },
    input: {
      event: "Stop" as const,
      providerSessionId: "private",
      providerTurnId: null,
      stopHookActive: false,
    },
    occurredAt: "2026-10-25T00:00:00.000Z",
    timing: budgetTerminalStages(new DisabledTerminalStageObservation()),
    expectation: {
      observationId: "tobs_expected123",
      providerSessionId: "private",
      provider: "claude" as const,
      contextEventId: "evt_context",
      workstreamId: null,
      revision: null,
      repositoryRevision: "sha256:opaque",
      preparedAt: "2026-10-25T00:00:00.000Z",
      workspaceBinding: worker
        ? {
            executionKind: "worker",
            workspaceId: "wsp_worker",
            workspaceGeneration: 1,
            workspaceRevision: 1,
            assignmentId: "asn_worker",
            leaseGeneration: 1,
            writerSessionId: "writer_worker",
          }
        : null,
    },
    io: {
      cwd: "/repository",
      stdout: (value: string) => output.push(value),
      stderr: () => undefined,
    },
  };
  const pending = completeTerminalHookTurn(input);
  return { pending, output };
}

describe("Stop failure versus isolation rejection", () => {
  it.each(["checkpoint", "pause"] as const)("blocks a worker after %s failure", async (port) => {
    ports[port].mockRejectedValue(new Error("private internal error"));
    const { pending, output } = invoke();
    expect(await pending).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({ decision: "block" });
    expect(ports.stages).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: "event_persistence_failed",
      }),
    );
  });

  it.each([
    ["repository_knowledge_inspection_failed", "knowledge_inspection_failed"],
    ["workstream_state_invalid", "lifecycle_inspection_failed"],
  ])("preserves worker and non-worker outcomes for %s", async (code, failureReason) => {
    ports.inspect.mockResolvedValue({
      status: "action_required",
      issues: [{ code, command: "lervo workspace inspect --json" }],
      workspace: {},
    });
    for (const worker of [true, false]) {
      const { pending, output } = invoke(worker);
      expect(await pending).toBe(0);
      expect(JSON.parse(output.join(""))).toEqual(
        worker ? { decision: "block", reason: expect.stringContaining(code) } : {},
      );
      expect(ports.stages).toHaveBeenLastCalledWith(expect.objectContaining({ failureReason }));
    }
  });

  it("still reaches the worker isolation block when capture throws", async () => {
    ports.inspect.mockResolvedValue({
      status: "action_required",
      issues: [{ code: "writer_lease_lost", command: "lervo workspace inspect --json" }],
      workspace: {},
    });
    ports.capture.mockRejectedValue(new Error("private capture failure"));
    const { pending, output } = invoke();
    expect(await pending).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({ decision: "block" });
    expect(ports.stages).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: "event_persistence_failed",
      }),
    );
  });

  it.each([true, false])(
    "allows current completion after capture failure (worker=%s)",
    async (worker) => {
      ports.capture.mockRejectedValue(new Error("private capture failure"));
      const { pending, output } = invoke(worker);
      expect(await pending).toBe(0);
      expect(JSON.parse(output.join(""))).toEqual({});
    },
  );

  it.each(["retrieval", "compact", "other"])("selects Stop prefetch for %s mode", async (mode) => {
    vi.stubEnv("LERVO_TERMINAL_HOOK_RUNTIME", "/runtime.js");
    vi.stubEnv("LERVO_TERMINAL_CONTEXT", mode);
    const { pending } = invoke();
    expect(await pending).toBe(0);
    expect(ports.launch).toHaveBeenCalledTimes(mode === "retrieval" ? 0 : 1);
    if (mode !== "retrieval")
      expect(ports.launch).toHaveBeenCalledWith(
        expect.objectContaining({ args: ["prefetch-context"] }),
      );
  });

  it("retains blocking for an observed worker ownership violation", async () => {
    ports.inspect.mockResolvedValue({
      status: "action_required",
      issues: [{ code: "writer_lease_lost", command: "lervo workspace inspect --json" }],
      workspace: {},
    });
    const { pending, output } = invoke();
    expect(await pending).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("writer_lease_lost"),
    });
  });
});
