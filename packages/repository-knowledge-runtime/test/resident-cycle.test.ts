import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RESIDENT_RECONCILE_BASE_MILLISECONDS as BASE,
  RESIDENT_RECONCILE_CEILING_MILLISECONDS as CEILING,
  nextIdleStreak,
  residentReconcileDelay,
  runResidentCycle,
} from "../src/resident-cycle.js";
import {
  RESIDENT_CYCLE_STATE_PATH,
  readResidentCycleState,
  writeResidentCycleState,
  type ResidentCycleState,
} from "../src/resident-cycle-state.js";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const NOW = Date.parse("2026-10-05T03:00:00.000Z");

function idleResult(state = "idle") {
  return {
    status: "processed" as const,
    outcomes: [],
    convergence: {
      transport: "ready" as const,
      debtCounts: { canonicalization: 0, normalization: 0, lifecycle: 0, historical: 0 },
      outstanding: 0,
      oldestAgeMilliseconds: null,
      activeStage: null,
      state,
      reason: null,
      lastVerifiedCurrency: null,
    },
  } as never;
}

function previous(overrides: Partial<ResidentCycleState> = {}): ResidentCycleState {
  return {
    schemaVersion: 1,
    fingerprint: FINGERPRINT,
    lastCycleAt: new Date(NOW - 60_000).toISOString(),
    lastResult: "idle",
    idleStreak: 1,
    nextReconcileAt: null,
    ...overrides,
  };
}

async function cycle(input: {
  previous: ResidentCycleState | null;
  fingerprint?: string;
  earliestAvailableAt?: number | null;
  observeFails?: boolean;
  result?: unknown;
  fails?: boolean;
  now?: number;
}) {
  let full = 0;
  const outcome = await runResidentCycle({
    previous: input.previous,
    now: () => input.now ?? NOW,
    ceilingMilliseconds: CEILING,
    observe: () => {
      if (input.observeFails) throw new Error("git unavailable");
      return {
        fingerprint: input.fingerprint ?? FINGERPRINT,
        sourceDigest: FINGERPRINT,
        earliestAvailableAt: input.earliestAvailableAt ?? null,
      };
    },
    runFull: async () => {
      full++;
      if (input.fails) throw new Error("cycle failed");
      return (input.result ?? idleResult()) as never;
    },
  });
  return { ...outcome, full };
}

describe("adaptive reconciliation", () => {
  it("backs off from one minute to the fifteen-minute ceiling and resets on work", () => {
    const delays: number[] = [];
    let streak = 0;
    for (let index = 0; index < 7; index++) {
      streak = nextIdleStreak(streak, index === 0 ? "idle" : "skipped");
      delays.push(
        residentReconcileDelay({
          idleStreak: streak,
          now: NOW,
          earliestAvailableAt: null,
          baseMilliseconds: BASE,
          ceilingMilliseconds: CEILING,
        }),
      );
    }
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
    streak = nextIdleStreak(streak, "processed");
    expect(
      residentReconcileDelay({
        idleStreak: streak,
        now: NOW,
        earliestAvailableAt: null,
        baseMilliseconds: BASE,
        ceilingMilliseconds: CEILING,
      }),
    ).toBe(60_000);
  });

  it("wakes for a future delivery but never busy-loops on an already due one", () => {
    const delay = (earliestAvailableAt: number) =>
      residentReconcileDelay({
        idleStreak: 5,
        now: NOW,
        earliestAvailableAt,
        baseMilliseconds: BASE,
        ceilingMilliseconds: CEILING,
      });
    expect(delay(NOW + 90_000)).toBe(90_000);
    expect(delay(NOW + 10)).toBe(1_000);
    expect(delay(NOW - 10)).toBe(900_000);
  });
});

describe("change fence", () => {
  it("skips an idle-class cycle only while the fingerprint is unchanged", async () => {
    for (const lastResult of ["idle", "waiting", "attention"] as const) {
      const skipped = await cycle({ previous: previous({ lastResult }) });
      expect(skipped).toMatchObject({ outcome: { kind: "skipped" }, full: 0 });
      expect(skipped.state).toMatchObject({ lastResult, idleStreak: 2, fingerprint: FINGERPRINT });
    }
    expect(await cycle({ previous: previous(), fingerprint: OTHER })).toMatchObject({ full: 1 });
  });

  it("runs in full without a trusted previous observation", async () => {
    expect(await cycle({ previous: null })).toMatchObject({ full: 1 });
    expect(await cycle({ previous: previous({ fingerprint: null }) })).toMatchObject({ full: 1 });
    expect(await cycle({ previous: previous({ lastResult: "processed" }) })).toMatchObject({
      full: 1,
    });
    expect(await cycle({ previous: previous({ lastResult: "failed" }) })).toMatchObject({
      full: 1,
    });
    expect(await cycle({ previous: previous({ lastCycleAt: null }) })).toMatchObject({ full: 1 });
  });

  it("runs in full when the fingerprint cannot be read and records no fingerprint", async () => {
    const result = await cycle({ previous: previous(), observeFails: true });
    expect(result).toMatchObject({ full: 1, state: { fingerprint: null, lastResult: "idle" } });
  });

  it("runs a due delivery and the ceiling cycle without the fence", async () => {
    expect(await cycle({ previous: previous(), earliestAvailableAt: NOW })).toMatchObject({
      full: 1,
    });
    expect(
      await cycle({
        previous: previous({ lastCycleAt: new Date(NOW - CEILING).toISOString() }),
      }),
    ).toMatchObject({ full: 1 });
    expect(await cycle({ previous: previous(), earliestAvailableAt: NOW + 1_000 })).toMatchObject({
      full: 0,
    });
  });

  it("classifies full cycles and records failures as untrusted", async () => {
    expect(await cycle({ previous: null, result: idleResult("waiting_authority") })).toMatchObject({
      state: { lastResult: "waiting", fingerprint: FINGERPRINT, idleStreak: 1 },
    });
    expect(await cycle({ previous: null, result: idleResult("recovery_required") })).toMatchObject({
      state: { lastResult: "attention" },
    });
    expect(await cycle({ previous: null, result: idleResult("running") })).toMatchObject({
      state: { lastResult: "processed", idleStreak: 0 },
    });
    expect(
      await cycle({
        previous: previous({ idleStreak: 3 }),
        fingerprint: OTHER,
        result: { status: "busy" },
      }),
    ).toMatchObject({ state: { lastResult: "processed", idleStreak: 0 } });
    expect(
      await cycle({ previous: previous({ idleStreak: 3 }), fingerprint: OTHER, fails: true }),
    ).toMatchObject({
      outcome: { kind: "failed" },
      state: { lastResult: "failed", fingerprint: null, idleStreak: 4 },
    });
  });
});

describe("resident cycle state", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
  });

  it("round-trips private state and treats missing or invalid state as absent", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-cycle-"));
    directories.push(root);
    expect(await readResidentCycleState(root)).toBeNull();
    const state = previous({ nextReconcileAt: new Date(NOW).toISOString() });
    await writeResidentCycleState(root, state);
    expect(await readResidentCycleState(root)).toEqual(state);
    expect((await stat(resolve(root, RESIDENT_CYCLE_STATE_PATH))).mode & 0o777).toBe(0o600);
    for (const invalid of [
      "not json",
      JSON.stringify({ ...state, schemaVersion: 2 }),
      JSON.stringify({ ...state, fingerprint: "sha256:short" }),
      JSON.stringify({ ...state, lastResult: "current" }),
      JSON.stringify({ ...state, idleStreak: -1 }),
      JSON.stringify({ ...state, lastCycleAt: "yesterday" }),
    ]) {
      await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
      await writeFile(resolve(root, RESIDENT_CYCLE_STATE_PATH), invalid);
      expect(await readResidentCycleState(root)).toBeNull();
    }
  });
});
