import { afterEach, expect, it, vi } from "vitest";

import { compactProjectConvergenceArtifacts } from "../src/cas-retention.js";
import {
  CAS_RETENTION_CONTINUE_MILLISECONDS as CONTINUE,
  casRetentionContinueAt,
  casRetentionWakeAt,
} from "../src/cas-retention-cadence.js";
import * as files from "../src/cas-retention-files.js";
import {
  RESIDENT_RECONCILE_BASE_MILLISECONDS as BASE,
  RESIDENT_RECONCILE_CEILING_MILLISECONDS as CEILING,
  residentNextCycleAt,
  runResidentCycle,
} from "../src/resident-cycle.js";
import type { ResidentCycleState } from "../src/resident-cycle-state.js";
import { retentionFixture } from "./cas-retention-fixture.js";

// ADR-0660: an idle resident, or one waiting on a provider, keeps retention due until it settles.
const fixtures: Awaited<ReturnType<typeof retentionFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.dispose();
});

const FINGERPRINT = `sha256:${"a".repeat(64)}`;

/** A cycle that ran retention, then found its provider unavailable: the WSL host's case. */
const providerWaiting = {
  status: "processed",
  outcomes: [],
  convergence: { state: "waiting_authority" },
} as never;

/** 41 candidates on a disk slow enough that one slice removes only the minimum of 32. */
async function slowHost() {
  const f = await retentionFixture();
  fixtures.push(f);
  // Observations stamp `new Date()`, so the whole Date is faked, not only `Date.now`.
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-28T10:00:00.000Z") });
  const clock = {
    get now() {
      return Date.now();
    },
    set now(at: number) {
      vi.setSystemTime(at);
    },
  };
  const remove = files.removeUnreachableCasObject;
  vi.spyOn(files, "removeUnreachableCasObject").mockImplementation(async (...args) => {
    clock.now += 1_000;
    return remove(...args);
  });
  const artifacts = [];
  for (let index = 0; index < 40; index++) artifacts.push(await f.put({ index }));
  await f.settled(
    "slow",
    artifacts.map((artifact) => artifact.contentHash),
  );
  return { f, clock };
}

/** One resident turn: observe the fence, run or skip the cycle, and schedule the next one. */
async function residentTurn(input: {
  root: string;
  storage: Awaited<ReturnType<typeof retentionFixture>>["storage"];
  previous: ResidentCycleState | null;
  clock: { now: number };
}) {
  let full = 0;
  const cycle = await runResidentCycle({
    repositoryRoot: input.root,
    previous: input.previous,
    now: () => input.clock.now,
    observe: () => ({
      fingerprint: FINGERPRINT,
      sourceDigest: FINGERPRINT,
      earliestAvailableAt: casRetentionWakeAt(input.root),
    }),
    // The default continuation reads the observation the cycle's own pass wrote.
    runFull: async () => {
      full++;
      await compactProjectConvergenceArtifacts(input.storage);
      // The provider stages that follow take a while and do nothing.
      input.clock.now += 45_000;
      return providerWaiting;
    },
  });
  const at = residentNextCycleAt({
    now: input.clock.now,
    cycle,
    unverifiable: false,
    publicationRetryAfterMs: null,
    baseMilliseconds: BASE,
    ceilingMilliseconds: CEILING,
  });
  return { cycle, at, full, previous: { ...cycle.state, nextReconcileAt: null } };
}

it("keeps the cycle due while a pass leaves work, even though the fingerprint is unchanged", async () => {
  const { f, clock } = await slowHost();
  const first = await residentTurn({ root: f.root, storage: f.storage, previous: null, clock });
  expect(first.full).toBe(1);
  expect(first.cycle.state.lastResult).toBe("waiting");
  // The pass removed its minimum of 32 and left 9, so the next slice is due a pause later.
  expect(first.at).toBe(clock.now + CONTINUE);
  const wakeAt = casRetentionWakeAt(f.root)!;
  expect(wakeAt).toBeLessThanOrEqual(first.at);
  // At the deadline the fence has not changed, but retention's due time forbids the skip.
  clock.now = first.at;
  const second = await residentTurn({
    root: f.root,
    storage: f.storage,
    previous: first.previous,
    clock,
  });
  expect(second.full).toBe(1);
  expect(second.cycle.outcome.kind).toBe("completed");
});

it("lets the resident idle once no work is left, and never loops on a pass it did not run", async () => {
  const { f, clock } = await slowHost();
  let previous: ResidentCycleState | null = null;
  let at = clock.now;
  for (let turn = 0; Number.isFinite(at); turn++) {
    expect(turn).toBeLessThan(8);
    clock.now = Math.max(clock.now, at);
    ({ at, previous } = await residentTurn({ root: f.root, storage: f.storage, previous, clock }));
  }
  expect(casRetentionWakeAt(f.root)).toBeNull();
  // An unchanged fence with nothing due is skipped, and only a change or due time wakes it.
  clock.now += 60 * 60_000;
  const idle = await residentTurn({ root: f.root, storage: f.storage, previous, clock });
  expect(idle).toMatchObject({ full: 0, at: Number.POSITIVE_INFINITY });
  // A cycle that ran no pass, such as off the base branch, never reads an old one as its own.
  expect(casRetentionContinueAt(f.root, clock.now + 1, clock.now + 2)).toBeNull();
});

it("removes every candidate across slices while each cycle waits on its provider", async () => {
  const { f, clock } = await slowHost();
  const before = (await files.casReferenceFiles(f.storage)).filter((file) => file.hash).length;
  let previous: ResidentCycleState | null = null;
  let at = clock.now;
  const results = [];
  while (Number.isFinite(at)) {
    expect(results.length).toBeLessThan(8);
    clock.now = Math.max(clock.now, at);
    const turn = await residentTurn({ root: f.root, storage: f.storage, previous, clock });
    ({ at, previous } = turn);
    results.push(turn.cycle.state.lastResult);
  }
  expect(new Set(results)).toEqual(new Set(["waiting"]));
  const after = (await files.casReferenceFiles(f.storage)).filter((file) => file.hash).length;
  expect(before - after).toBe(41);
});
