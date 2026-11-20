import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { defaultRepositoryHoldPath, readRepositoryHold } from "@lervo/repository-registry";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
vi.mock("../src/resident-health.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/resident-health.js")>()),
  recordKnowledgeResidentHealth: vi.fn(async () => undefined),
}));
vi.mock("../src/resident-cycle-state.js", () => ({
  readResidentCycleState: vi.fn(async () => null),
  writeResidentCycleState: vi.fn(async () => undefined),
}));
// The hold store lives in a private user state directory, so its watch sees only this test.
let userState: string;
const savedUserState = process.env.LERVO_USER_STATE_DIRECTORY;
beforeEach(() => {
  userState = mkdtempSync(join(tmpdir(), "lervo-loop-health-"));
  process.env.LERVO_USER_STATE_DIRECTORY = userState;
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  if (savedUserState === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = savedUserState;
  rmSync(userState, { recursive: true, force: true });
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
    const storage = {
      paths: { repositoryRoot: "/fixture" },
      manifest: { projectId: "prj_fixture" },
    } as unknown as ProjectStorage;
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
  const storage = {
    paths: { repositoryRoot: "/fixture" },
    manifest: { projectId: "prj_fixture" },
  } as unknown as ProjectStorage;
  const stop = startAutonomousKnowledgeWorker({
    storage,
    workerId: "resident",
    provider: "codex",
    subscribe: () => () => undefined,
    refreshHealth,
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

it("arms a bounded number of timers while a long cycle runs past a moved head's deadline (ADR-0602)", async () => {
  // A real checkout, so the projection key is computable and only the moving head differs.
  const root = mkdtempSync(join(tmpdir(), "lervo-loop-head-"));
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  vi.useFakeTimers();
  const skipped = () => ({
    state: {
      schemaVersion: 1 as const,
      fingerprint: null,
      lastCycleAt: new Date().toISOString(),
      lastResult: "idle" as const,
      idleStreak: 1,
    },
    earliestAvailableAt: null,
    observedAt: Date.now(),
    outcome: { kind: "skipped" as const },
  });
  let finishCycle!: () => void;
  // Two quick cycles: the first refreshes, the second sees a moved head inside the event interval
  // and leaves its deadline at the interval. The third runs past that deadline.
  vi.mocked(runResidentCycle)
    .mockImplementationOnce(async () => skipped())
    .mockImplementationOnce(async () => skipped())
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCycle = () => resolve(skipped());
        }),
    );
  let head = 0;
  const storage = {
    paths: { repositoryRoot: root },
    manifest: { projectId: "prj_fixture" },
    // Every read sees a new head, as a busy session appends events throughout.
    events: { latestHash: () => `evt_${(head += 1)}` },
  } as unknown as ProjectStorage;
  const refreshHealth = vi.fn(async () => undefined);
  // A deadline handed back unchanged and past would be refused and reported here.
  const onFailure = vi.fn();
  let wake!: () => void;
  const stop = startAutonomousKnowledgeWorker({
    storage,
    workerId: "resident",
    provider: "codex",
    subscribe: (notify) => {
      wake = notify;
      return () => undefined;
    },
    refreshHealth,
    projectionMaximumAgeMilliseconds: 1_200_000,
    onFailure,
  });
  try {
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshHealth).toHaveBeenCalledTimes(1);
    wake();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(2);
    expect(refreshHealth).toHaveBeenCalledTimes(1);
    wake();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(3);
    const timeouts = vi.spyOn(globalThis, "setTimeout");
    try {
      // The moved head's event interval passes while the cycle runs: only the age bound applies.
      await vi.advanceTimersByTimeAsync(1_200_000);
      expect(timeouts.mock.calls.length).toBeLessThan(10);
    } finally {
      timeouts.mockRestore();
    }
    expect(refreshHealth).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
    finishCycle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onFailure).not.toHaveBeenCalled();
  } finally {
    await stop();
    vi.mocked(runResidentCycle).mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});

it(
  "runs once more when the hold store changes during a cycle (ADR-0602)",
  { timeout: 30_000 },
  async () => {
    // Still held when read after the cycle, so only the change seen mid-cycle can start another.
    vi.mocked(readRepositoryHold).mockImplementation(async (repositoryRoot) => ({
      repositoryRoot,
      reason: null,
      heldAt: new Date(0).toISOString(),
    }));
    let finishCycle!: () => void;
    const result = {
      state: {
        schemaVersion: 1 as const,
        fingerprint: null,
        lastCycleAt: new Date().toISOString(),
        lastResult: "held" as const,
        idleStreak: 1,
      },
      earliestAvailableAt: null,
      observedAt: Date.now(),
      outcome: { kind: "skipped" as const },
    };
    vi.mocked(runResidentCycle)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishCycle = () => resolve(result);
          }),
      )
      .mockImplementation(async () => result);
    const storage = {
      paths: { repositoryRoot: "/fixture" },
      manifest: { projectId: "prj_fixture" },
    } as unknown as ProjectStorage;
    const stop = startAutonomousKnowledgeWorker({
      storage,
      workerId: "resident",
      provider: "codex",
      subscribe: () => () => undefined,
      wakeDebounceMilliseconds: 10,
      onFailure: vi.fn(),
    });
    try {
      await vi.waitFor(() => expect(runResidentCycle).toHaveBeenCalledTimes(1));
      // The store changes while the cycle runs; the watch event takes real file-system time.
      for (let index = 0; index < 30; index++) {
        writeFileSync(defaultRepositoryHoldPath(), `[] ${index}\n`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      finishCycle();
      await vi.waitFor(() => expect(runResidentCycle).toHaveBeenCalledTimes(2), {
        timeout: 5_000,
      });
    } finally {
      await stop();
      vi.mocked(readRepositoryHold).mockImplementation(async () => null);
      vi.mocked(runResidentCycle).mockReset();
    }
  },
);

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
  const storage = {
    paths: { repositoryRoot: "/fixture" },
    manifest: { projectId: "prj_fixture" },
  } as unknown as ProjectStorage;
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
    /** The owner releases the hold: the store changes, as `lervo repository release` writes it. */
    release: () => {
      holding = false;
      writeFileSync(defaultRepositoryHoldPath(), "[]\n");
    },
    stop: async () => {
      await stop();
      vi.mocked(readRepositoryHold).mockImplementation(async () => null);
      vi.mocked(runResidentCycle).mockReset();
    },
  };
}

it("keeps a held repository asleep and refreshes its health once an hour (ADR-0595, ADR-0602)", async () => {
  const held = startHeldResident();
  try {
    await vi.advanceTimersByTimeAsync(600_000);
    // Held, it has no deadline at all (ADR-0602): one observation in ten minutes.
    expect(runResidentCycle).toHaveBeenCalledTimes(1);
    // One refresh shows the hold; nothing refreshes it again before the held maximum age.
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

it("wakes a held resident when the hold store records the release (ADR-0595, ADR-0602)", async () => {
  const held = startHeldResident();
  try {
    await vi.advanceTimersByTimeAsync(600_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(1);
    const checks = vi.mocked(readRepositoryHold).mock.calls.length;
    held.release();
    // The store's watch checks the hold at once; the wake then waits out its 30-second debounce.
    await vi.waitFor(
      () => expect(vi.mocked(readRepositoryHold).mock.calls.length).toBeGreaterThan(checks),
      { timeout: 5_000, interval: 20 },
    );
    await vi.advanceTimersByTimeAsync(31_000);
    expect(runResidentCycle).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runResidentCycle).mock.calls[1]![0].previous).toMatchObject({ idleStreak: 0 });
    expect(held.refreshHealth).toHaveBeenCalledTimes(2);
  } finally {
    await held.stop();
  }
});

it("backs off a cycle that keeps failing outside the fence and resets on a wakeup (ADR-0595)", async () => {
  vi.useFakeTimers();
  vi.mocked(runResidentCycle).mockRejectedValue(new Error("Observation failed"));
  let wake!: () => void;
  const storage = {
    paths: { repositoryRoot: "/fixture" },
    manifest: { projectId: "prj_fixture" },
  } as unknown as ProjectStorage;
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
