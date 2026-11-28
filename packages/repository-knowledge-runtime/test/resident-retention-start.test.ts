import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { RETENTION_START_DELAY_MILLISECONDS } from "../src/resident-retention.js";
import { residentCycleSkippable } from "../src/resident-cycle.js";
import { writeResidentCycleState } from "../src/resident-cycle-state.js";
import { residentFingerprint } from "../src/resident-fingerprint.js";
import { residentWakeOffset } from "../src/resident-wake-offset.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

// ADR-0660: a restarted resident whose fence is unchanged skips its full cycle, and still starts
// retention on its own deadline, as the WSL checkout needed after the upgrade to 0.69.1.
vi.mock("../src/worker.js", () => ({ runAutonomousKnowledgeWorker: vi.fn() }));

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Lets real file, process and database I/O finish; only timers and the clock are faked. */
async function settle(rounds = 200) {
  for (let index = 0; index < rounds; index++)
    await new Promise((resolveRound) => setImmediate(resolveRound));
}

it(
  "runs a retention slice without a full cycle or provider call after a restart",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const state = resolve(f.root, ".lervo/state/knowledge");
    await mkdir(state, { recursive: true });
    // The observation 0.69.0 left: older than the cadence, with no `remaining`.
    await writeFile(
      resolve(state, "cas-retention-observation.json"),
      JSON.stringify({
        schemaVersion: 1,
        observedAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
        status: "yielded",
        failure: null,
        removedObjects: 0,
        reclaimedBytes: 0,
      }),
    );
    // The last full cycle saw exactly this fence and waited.
    const fence = residentFingerprint({
      repositoryRoot: f.root,
      events: f.storage.events,
      wakeOffsetMilliseconds: residentWakeOffset(f.storage.manifest.projectId),
      owner: null,
      hubToken: null,
    });
    const previous = {
      schemaVersion: 1 as const,
      fingerprint: fence.fingerprint,
      lastCycleAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
      lastResult: "waiting" as const,
      lastFailure: null,
      idleStreak: 1,
      nextReconcileAt: null,
    };
    expect(residentCycleSkippable({ previous, observed: fence, now: Date.now() })).toBe(true);
    await writeResidentCycleState(f.root, previous);
    const failures: unknown[] = [];
    const observationPath = resolve(state, "cas-retention-observation.json");
    const recorded = async () =>
      JSON.parse(await readFile(observationPath, "utf8")) as Record<string, unknown>;
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      subscribe: () => () => undefined,
      onFailure: (error) => failures.push(error),
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      await settle();
      await vi.advanceTimersByTimeAsync(RETENTION_START_DELAY_MILLISECONDS.maximum);
      // The slice runs Git, SQLite and file I/O for real; wait in real time for its pass.
      const giveUpAt = performance.now() + 90_000;
      while (!("remaining" in (await recorded())) && performance.now() < giveUpAt) {
        await settle(20);
        await vi.advanceTimersByTimeAsync(0);
      }
    } finally {
      await stop();
    }
    expect(runAutonomousKnowledgeWorker).not.toHaveBeenCalled();
    expect(await exists(resolve(f.directory, "provider-calls.jsonl"))).toBe(false);
    expect(failures).toEqual([]);
    // The slice ran a pass, whose observation now says whether work is left.
    const observation = await recorded();
    expect(typeof observation.remaining).toBe("boolean");
    expect(Date.parse(String(observation.observedAt))).toBeGreaterThan(
      Date.parse(previous.lastCycleAt),
    );
  },
);
