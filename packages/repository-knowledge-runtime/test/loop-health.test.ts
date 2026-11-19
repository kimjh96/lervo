import type { ProjectStorage } from "@lervo/project-storage";
import { readRepositoryHold } from "@lervo/repository-registry";
import { afterEach, expect, it, vi } from "vitest";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { runResidentCycle } from "../src/resident-cycle.js";
import { recordKnowledgeResidentHealth } from "../src/resident-health.js";
import { readResidentCycleState, writeResidentCycleState } from "../src/resident-cycle-state.js";

vi.mock("../src/resident-cycle.js", async (original) => ({
  ...(await original<typeof import("../src/resident-cycle.js")>()),
  runResidentCycle: vi.fn(),
}));
vi.mock("@lervo/repository-registry", async (original) => ({
  ...(await original<typeof import("@lervo/repository-registry")>()),
  readRepositoryHold: vi.fn(async () => null),
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

it("refreshes health by its age bound while a long cycle runs, one refresh at a time", async () => {
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
    projectionMaximumAgeMilliseconds: 300_000,
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

/** A resident whose repository the owner holds until `release()`. */
function startHeldResident() {
  vi.useFakeTimers();
  let holding = true;
  vi.mocked(readRepositoryHold).mockImplementation(async (repositoryRoot) =>
    holding ? { repositoryRoot, reason: null, heldAt: new Date(0).toISOString() } : null,
  );
  vi.mocked(runResidentCycle).mockImplementation(async (input) => ({
    state: {
      schemaVersion: 1,
      fingerprint: null,
      lastCycleAt: new Date().toISOString(),
      lastResult: holding ? "held" : "idle",
      idleStreak: (input.previous?.idleStreak ?? 0) + 1,
    },
    earliestAvailableAt: null,
    observedAt: Date.now(),
    outcome: { kind: "skipped" },
  }));
  const refreshHealth = vi.fn(async () => undefined);
  const storage = { paths: { repositoryRoot: "/fixture" } } as unknown as ProjectStorage;
  const stop = startAutonomousKnowledgeWorker({
    storage,
    workerId: "resident",
    provider: "codex",
    subscribe: () => () => undefined,
    refreshHealth,
    onFailure: vi.fn(),
  });
  return {
    refreshHealth,
    release: () => {
      holding = false;
    },
    stop: async () => {
      await stop();
      vi.mocked(readRepositoryHold).mockImplementation(async () => null);
      vi.mocked(runResidentCycle).mockReset();
    },
  };
}

it("backs a held repository off and refreshes its health once an hour (ADR-0595)", async () => {
  const held = startHeldResident();
  try {
    await vi.advanceTimersByTimeAsync(600_000);
    // Held cycles back off 1, 2 and 4 minutes instead of running every minute.
    expect(runResidentCycle).toHaveBeenCalledTimes(4);
    // One refresh shows the hold; neither the check ticks nor the cycles refresh it again.
    expect(held.refreshHealth).toHaveBeenCalledTimes(1);
    expect(recordKnowledgeResidentHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "busy", reason: "repository_owner_hold" }),
    );
    await vi.advanceTimersByTimeAsync(2_999_000);
    expect(held.refreshHealth).toHaveBeenCalledTimes(1);
    // The held maximum age refreshes its Node, replica and attention lines after an hour.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(held.refreshHealth).toHaveBeenCalledTimes(2);
  } finally {
    await held.stop();
  }
});

it("wakes a held resident on release through the hold check (ADR-0595)", async () => {
  const held = startHeldResident();
  try {
    await vi.advanceTimersByTimeAsync(600_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(4);
    // The next held cycle would wait until 15 minutes; the release must not wait for it.
    held.release();
    // The release check runs within a minute and wakes the resident after the 30-second debounce.
    await vi.advanceTimersByTimeAsync(91_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(5);
    expect(vi.mocked(runResidentCycle).mock.calls[4]![0].previous).toMatchObject({ idleStreak: 0 });
    expect(held.refreshHealth).toHaveBeenCalledTimes(2);
  } finally {
    await held.stop();
  }
});

it("backs off a cycle that keeps failing outside the fence and resets on a wakeup (ADR-0595)", async () => {
  vi.useFakeTimers();
  vi.mocked(runResidentCycle).mockRejectedValue(new Error("Observation failed"));
  let wake!: () => void;
  const storage = { paths: { repositoryRoot: "/fixture" } } as unknown as ProjectStorage;
  const stop = startAutonomousKnowledgeWorker({
    storage,
    workerId: "resident",
    provider: "codex",
    subscribe: (notify) => {
      wake = notify;
      return () => undefined;
    },
    onFailure: vi.fn(),
  });
  try {
    // Failures at 0, 1, 3 and 7 minutes: 60, 120 and 240 seconds apart, never every minute.
    await vi.advanceTimersByTimeAsync(420_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(4);
    // The fourth failure waits 8 minutes, until 15 minutes.
    await vi.advanceTimersByTimeAsync(400_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(4);
    wake();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(5);
    // The wakeup reset the streak, so the next failure retries after the base minute.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(6);
  } finally {
    await stop();
    vi.mocked(runResidentCycle).mockReset();
  }
});
