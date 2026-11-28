import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE } from "../src/cas-retention-host-turns.js";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { runResidentCycle } from "../src/resident-cycle.js";
import { runRetentionOnlySlice } from "../src/retention-only-slice.js";

// ADR-0660: the retention deadline runs a retention-only slice, never the full worker cycle.
vi.mock("../src/resident-cycle.js", async (original) => ({
  ...(await original<typeof import("../src/resident-cycle.js")>()),
  runResidentCycle: vi.fn(),
}));
vi.mock("../src/retention-only-slice.js", () => ({ runRetentionOnlySlice: vi.fn() }));
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

let root: string;
const savedUserState = process.env.LERVO_USER_STATE_DIRECTORY;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lervo-loop-retention-"));
  process.env.LERVO_USER_STATE_DIRECTORY = join(root, "user-state");
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  if (savedUserState === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = savedUserState;
  rmSync(root, { recursive: true, force: true });
});

/** Lets real file and database I/O finish; only timers and the clock are faked. */
async function settle() {
  for (let index = 0; index < 200; index++) await new Promise((resolve) => setImmediate(resolve));
}

it(
  "runs only retention slices while work is left, then sleeps until a change",
  { timeout: 30_000 },
  async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const state = join(root, ".lervo/state/knowledge");
    mkdirSync(state, { recursive: true });
    // The startup cycle's own pass left work behind.
    writeFileSync(
      join(state, "cas-retention-observation.json"),
      JSON.stringify({
        status: "collected",
        observedAt: new Date().toISOString(),
        remaining: true,
      }),
    );
    vi.mocked(runResidentCycle).mockResolvedValue({
      state: {
        schemaVersion: 1,
        fingerprint: null,
        lastCycleAt: new Date().toISOString(),
        lastResult: "waiting",
        lastFailure: null,
        idleStreak: 1,
      },
      earliestAvailableAt: null,
      observedAt: Date.now(),
      outcome: { kind: "skipped" },
    });
    const slice = (remaining: boolean) => ({
      kind: "slice" as const,
      slice: { outcome: "ran" as const, observation: { remaining } as never, retryAt: null },
    });
    vi.mocked(runRetentionOnlySlice)
      .mockResolvedValueOnce(slice(true))
      .mockResolvedValueOnce(slice(true))
      .mockResolvedValueOnce(slice(false));
    const storage = {
      paths: { repositoryRoot: root, knowledgeState: state },
      manifest: { projectId: "prj_fixture" },
    } as unknown as ProjectStorage;
    const stop = startAutonomousKnowledgeWorker({
      storage,
      workerId: "resident",
      provider: "claude",
      admissionDirectory: join(root, "admission"),
      subscribe: () => () => undefined,
      onFailure: () => undefined,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      await settle();
      expect(runResidentCycle).toHaveBeenCalledTimes(1);
      expect(runRetentionOnlySlice).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(PAUSE);
      await settle();
      expect(runRetentionOnlySlice).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(PAUSE);
      await settle();
      await vi.advanceTimersByTimeAsync(PAUSE);
      await settle();
      expect(runRetentionOnlySlice).toHaveBeenCalledTimes(3);
      // The last slice left nothing, so nothing more is due; no retention wake ran a full cycle.
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      await settle();
      expect(runRetentionOnlySlice).toHaveBeenCalledTimes(3);
      expect(runResidentCycle).toHaveBeenCalledTimes(1);
    } finally {
      await stop();
    }
  },
);
