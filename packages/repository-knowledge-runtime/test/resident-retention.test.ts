import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE } from "../src/cas-retention-host-turns.js";
import type { CasRetentionSlice } from "../src/cas-retention-slice.js";
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

it("keeps the next slice due while a pass leaves work", () => {
  expect(nextRetentionWake(ran(true), PAUSE, NOW)).toEqual({ at: NOW + PAUSE, backoff: PAUSE });
  const deferred: RetentionOnlyOutcome = {
    kind: "slice",
    slice: { outcome: "deferred", observation: null, retryAt: NOW + 12_000 },
  };
  expect(nextRetentionWake(deferred, PAUSE, NOW).at).toBe(NOW + 12_000);
  expect(nextRetentionWake({ kind: "admission_busy" }, PAUSE, NOW).at).toBe(NOW + PAUSE);
});

it("lets the resident idle once no work is left, and on a held or off-base checkout", () => {
  expect(nextRetentionWake(ran(false), 4 * PAUSE, NOW)).toEqual({ at: null, backoff: PAUSE });
  expect(nextRetentionWake({ kind: "held" }, PAUSE, NOW).at).toBeNull();
  expect(nextRetentionWake({ kind: "off_base" }, PAUSE, NOW).at).toBeNull();
});

it("backs off to ten minutes while live work holds, and resumes its pace after a slice", () => {
  const entryYield: RetentionOnlyOutcome = {
    kind: "slice",
    slice: { outcome: "entry_yield", observation: null, retryAt: null },
  };
  let backoff = PAUSE;
  const waits: number[] = [];
  for (const outcome of [entryYield, { kind: "live_work" as const }, entryYield, entryYield]) {
    const next = nextRetentionWake(outcome, backoff, NOW);
    waits.push(next.at! - NOW);
    backoff = next.backoff;
  }
  expect(waits).toEqual([2 * PAUSE, 4 * PAUSE, 8 * PAUSE, 16 * PAUSE]);
  for (let index = 0; index < 4; index++)
    backoff = nextRetentionWake({ kind: "live_work" }, backoff, NOW).backoff;
  expect(backoff).toBe(CEILING);
  expect(nextRetentionWake(ran(true), backoff, NOW)).toEqual({ at: NOW + PAUSE, backoff: PAUSE });
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
});

it("runs no slice and arms nothing while a full cycle runs", async () => {
  const armed: (number | null)[] = [];
  let cycleRunning = true;
  let slices = 0;
  const retention = residentRetention({
    runSlice: async () => {
      slices++;
      return ran(true);
    },
    pendingAfterCycle: () => NOW + PAUSE,
    cycleRunning: () => cycleRunning,
    arm: (at) => armed.push(at),
    onFailure: () => undefined,
    now: () => NOW,
  });
  await retention.run();
  expect(slices).toBe(0);
  cycleRunning = false;
  retention.afterCycle();
  await retention.run();
  expect(slices).toBe(1);
  expect(armed).toEqual([NOW + PAUSE, NOW + PAUSE]);
});
