import type { ProjectStorage } from "@lervo/project-storage";
import { afterEach, expect, it, vi } from "vitest";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { runResidentCycle } from "../src/resident-cycle.js";
import { recordKnowledgeResidentHealth } from "../src/resident-health.js";
import { readResidentCycleState, writeResidentCycleState } from "../src/resident-cycle-state.js";

vi.mock("../src/resident-cycle.js", async (original) => ({
  ...(await original<typeof import("../src/resident-cycle.js")>()),
  runResidentCycle: vi.fn(),
}));
vi.mock("../src/resident-health.js", () => ({
  recordKnowledgeResidentHealth: vi.fn(async () => undefined),
}));
vi.mock("../src/resident-cycle-state.js", () => ({
  readResidentCycleState: vi.fn(async () => null),
  writeResidentCycleState: vi.fn(async () => undefined),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it.each(["skipped", "failed", "rejected"] as const)(
  "refreshes health after a %s cycle and its heartbeat",
  async (kind) => {
    vi.useFakeTimers();
    const state = {
      schemaVersion: 1 as const,
      fingerprint: null,
      lastCycleAt: new Date().toISOString(),
      lastResult: kind === "skipped" ? ("waiting" as const) : ("failed" as const),
      idleStreak: 1,
      nextReconcileAt: null,
    };
    if (kind === "rejected")
      vi.mocked(runResidentCycle).mockRejectedValueOnce(new Error("Observation failed"));
    else
      vi.mocked(runResidentCycle).mockResolvedValueOnce({
        state,
        earliestAvailableAt: null,
        observedAt: 0,
        outcome: kind === "skipped" ? { kind } : { kind, error: new Error("Cycle failed") },
      });
    const refreshHealth = vi.fn(async () => {
      expect(recordKnowledgeResidentHealth).toHaveBeenCalled();
    });
    const onFailure = vi.fn();
    const storage = { paths: { repositoryRoot: "/fixture" } } as unknown as ProjectStorage;
    const stop = startAutonomousKnowledgeWorker({
      storage,
      workerId: "resident",
      provider: "codex",
      subscribe: () => () => undefined,
      refreshHealth,
      onFailure,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshHealth).toHaveBeenCalledTimes(1);
      expect(recordKnowledgeResidentHealth).toHaveBeenCalledWith(
        expect.objectContaining({ state: kind === "skipped" ? "waiting" : "attention" }),
      );
      expect(onFailure).toHaveBeenCalledTimes(kind === "skipped" ? 0 : 1);
      expect(readResidentCycleState).toHaveBeenCalledTimes(1);
      if (kind !== "rejected") expect(writeResidentCycleState).toHaveBeenCalledTimes(1);
    } finally {
      await stop();
    }
  },
);

it("refreshes health on its own cadence while a long cycle runs, one refresh at a time", async () => {
  vi.useFakeTimers();
  let finishCycle!: () => void;
  vi.mocked(runResidentCycle).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCycle = () =>
          resolve({
            state: {
              schemaVersion: 1,
              fingerprint: null,
              lastCycleAt: new Date().toISOString(),
              lastResult: "waiting",
              idleStreak: 1,
            },
            earliestAvailableAt: null,
            observedAt: 0,
            outcome: { kind: "skipped" },
          });
      }),
  );
  let active = 0;
  let overlapped = false;
  const refreshHealth = vi.fn(async () => {
    active += 1;
    overlapped ||= active > 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    active -= 1;
  });
  const storage = { paths: { repositoryRoot: "/fixture" } } as unknown as ProjectStorage;
  const stop = startAutonomousKnowledgeWorker({
    storage,
    workerId: "resident",
    provider: "codex",
    subscribe: () => () => undefined,
    refreshHealth,
    healthRefreshMilliseconds: 300_000,
    onFailure: vi.fn(),
  });
  try {
    await vi.advanceTimersByTimeAsync(900_000);
    // The cycle has not finished, yet the projection stayed within its 20-minute window.
    expect(refreshHealth).toHaveBeenCalledTimes(3);
    finishCycle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refreshHealth).toHaveBeenCalledTimes(4);
    expect(overlapped).toBe(false);
  } finally {
    await stop();
  }
});
