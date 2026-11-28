import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE } from "../src/cas-retention-host-turns.js";
import type { CasRetentionSlice } from "../src/cas-retention-slice.js";
import { recordRetentionWait } from "../src/cas-retention-wait.js";
import {
  RETENTION_BACKOFF_CEILING_MILLISECONDS as CEILING,
  nextRetentionWake,
  residentRetention,
  retentionPendingAfterCycle,
} from "../src/resident-retention.js";
import type { RetentionOnlyOutcome } from "../src/retention-only-slice.js";

// ADR-0660: when the resident asks for its next retention-only slice.
const NOW = Date.parse("2026-11-28T12:00:00.000Z");
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function ran(remaining: boolean): RetentionOnlyOutcome {
  return {
    kind: "slice",
    slice: {
      outcome: "ran",
      observation: { remaining } as CasRetentionSlice["observation"],
      retryAt: null,
    },
  };
}

it("keeps the next slice due while a pass leaves work, and comes back for a deferred turn", () => {
  expect(nextRetentionWake(ran(true), PAUSE, NOW)).toEqual({
    at: NOW + PAUSE,
    backoff: PAUSE,
    wait: null,
  });
  // A deferred turn holds its place only if its owner comes back exactly when told.
  expect(
    nextRetentionWake({ kind: "turn_deferred", retryAt: NOW + 12_000 }, 4 * PAUSE, NOW),
  ).toEqual({ at: NOW + 12_000, backoff: 4 * PAUSE, wait: "retention_turn" });
});

it("lets the resident idle once no work is left, and on a held or off-base checkout", () => {
  expect(nextRetentionWake(ran(false), 4 * PAUSE, NOW)).toEqual({
    at: null,
    backoff: PAUSE,
    wait: null,
  });
  expect(nextRetentionWake({ kind: "held" }, PAUSE, NOW).at).toBeNull();
  expect(nextRetentionWake({ kind: "off_base" }, PAUSE, NOW).at).toBeNull();
});

it("backs off to ten minutes behind live work or busy cycles, and resumes after a slice", () => {
  const entryYield: RetentionOnlyOutcome = {
    kind: "slice",
    slice: { outcome: "entry_yield", observation: null, retryAt: null },
  };
  let backoff = PAUSE;
  const waits: number[] = [];
  const busy = { kind: "admission_busy" as const };
  for (const outcome of [entryYield, { kind: "live_work" as const }, busy, entryYield]) {
    const next = nextRetentionWake(outcome, backoff, NOW);
    waits.push(next.at! - NOW);
    backoff = next.backoff;
  }
  expect(waits).toEqual([2 * PAUSE, 4 * PAUSE, 8 * PAUSE, 16 * PAUSE]);
  for (let index = 0; index < 4; index++)
    backoff = nextRetentionWake({ kind: "live_work" }, backoff, NOW).backoff;
  expect(backoff).toBe(CEILING);
  expect(nextRetentionWake(busy, backoff, NOW)).toMatchObject({
    at: NOW + CEILING,
    wait: "admission_busy",
  });
  expect(nextRetentionWake(ran(true), backoff, NOW)).toMatchObject({
    at: NOW + PAUSE,
    backoff: PAUSE,
  });
});

it("arms after a full cycle only for a recent pass that left work", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-retention-"));
  directories.push(root);
  const state = resolve(root, ".lervo/state/knowledge");
  await mkdir(state, { recursive: true });
  const record = (observation: Record<string, unknown>) =>
    writeFile(resolve(state, "cas-retention-observation.json"), JSON.stringify(observation));
  expect(retentionPendingAfterCycle(root, NOW)).toBeNull();
  const observedAt = new Date(NOW - 60_000).toISOString();
  await record({ status: "collected", observedAt, remaining: true });
  expect(retentionPendingAfterCycle(root, NOW)).toBe(NOW + PAUSE);
  await record({ status: "collected", observedAt, remaining: false });
  expect(retentionPendingAfterCycle(root, NOW)).toBeNull();
  await record({ status: "unavailable", observedAt, remaining: true });
  expect(retentionPendingAfterCycle(root, NOW)).toBeNull();
  const stale = new Date(NOW - 25 * 60 * 60_000).toISOString();
  await record({ status: "collected", observedAt: stale, remaining: true });
  expect(retentionPendingAfterCycle(root, NOW)).toBeNull();
  // A full cycle whose retention was denied the turn comes back exactly when the denial said,
  // even though its last pass left nothing.
  await record({ status: "collected", observedAt, remaining: false });
  await recordRetentionWait(state, "retention_turn", NOW - 5_000, NOW + 12_000);
  expect(retentionPendingAfterCycle(root, NOW)).toBe(NOW + 12_000);
  // A denial whose moment passed long ago no longer speaks.
  await recordRetentionWait(state, "retention_turn", NOW - 60_000, NOW - 30_000);
  expect(retentionPendingAfterCycle(root, NOW)).toBeNull();
});

function controller(overrides: Partial<Parameters<typeof residentRetention>[0]> = {}) {
  const armed: (number | null)[] = [];
  const waits: unknown[] = [];
  const failures: unknown[] = [];
  const retention = residentRetention({
    runSlice: async () => ran(true),
    pendingAfterCycle: async () => NOW + PAUSE,
    liveWorkPending: async () => false,
    cycleRunning: () => false,
    arm: (at) => armed.push(at),
    recordWait: async (cause) => void waits.push(cause),
    stopped: () => false,
    onFailure: (error) => failures.push(error),
    now: () => NOW,
    ...overrides,
  });
  return { retention, armed, waits, failures };
}

it("runs no slice and arms nothing while a full cycle runs", async () => {
  let cycleRunning = true;
  let slices = 0;
  const { retention, armed } = controller({
    runSlice: async () => {
      slices++;
      return ran(true);
    },
    cycleRunning: () => cycleRunning,
  });
  await retention.run();
  expect(slices).toBe(0);
  cycleRunning = false;
  await retention.afterCycle();
  await retention.run();
  expect(slices).toBe(1);
  expect(armed).toEqual([NOW + PAUSE, NOW + PAUSE]);
});

it("keeps its live-work backoff after a full cycle, and records why it waits", async () => {
  let live = true;
  const { retention, armed, waits } = controller({
    runSlice: async () => ({ kind: "live_work" }),
    liveWorkPending: async () => live,
  });
  await retention.run();
  await retention.run();
  expect(armed).toEqual([NOW + 2 * PAUSE, NOW + 4 * PAUSE]);
  expect(waits).toEqual(["live_work", "live_work"]);
  await retention.afterCycle();
  expect(armed.at(-1)).toBe(NOW + 4 * PAUSE);
  live = false;
  await retention.afterCycle();
  expect(armed.at(-1)).toBe(NOW + PAUSE);
});

it("reports no failure for a slice cut short by the resident stopping", async () => {
  const { retention, armed, failures } = controller({
    runSlice: async () => {
      throw Object.assign(new Error("cancelled"), { code: "knowledge_cancelled" });
    },
    stopped: () => true,
  });
  await retention.run();
  expect(failures).toEqual([]);
  expect(armed).toEqual([]);
});
