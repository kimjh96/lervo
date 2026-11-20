import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "../src/failure.js";

import {
  RESIDENT_RECONCILE_BASE_MILLISECONDS as BASE,
  RESIDENT_RECONCILE_CEILING_MILLISECONDS as CEILING,
  nextIdleStreak,
  residentCadence,
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
  error?: unknown;
  now?: number;
}) {
  let full = 0;
  const outcome = await runResidentCycle({
    repositoryRoot: "/work/repo",
    previous: input.previous,
    now: () => input.now ?? NOW,
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
      if (input.error !== undefined) throw input.error;
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

  it("wakes at once when a due time passes between the cycle and its scheduling", () => {
    const delay = (earliestAvailableAt: number, observedAt: number) =>
      residentReconcileDelay({
        idleStreak: 5,
        now: NOW,
        earliestAvailableAt,
        observedAt,
        baseMilliseconds: BASE,
        ceilingMilliseconds: CEILING,
      });
    // Future when the cycle finished, past once publication and the projection refresh returned.
    expect(delay(NOW - 10, NOW - 5_000)).toBe(1_000);
    expect(delay(NOW, NOW - 5_000)).toBe(1_000);
    // Already due when observed: deferred work keeps backing off instead of busy-looping.
    expect(delay(NOW - 10_000, NOW - 5_000)).toBe(900_000);
    expect(delay(NOW + 90_000, NOW - 5_000)).toBe(90_000);
  });
});

describe("change fence", () => {
  it("records a typed failure with root-relative detail on one bounded line", async () => {
    const message = `/work/repo/docs/a.md changed\r\n\0/work/repo/docs/b.md ${"x".repeat(500)}`;
    const result = await cycle({
      previous: null,
      error: new RepositoryKnowledgeError("source_bytes_changed", message),
    });
    expect(result.state.lastFailure).toEqual({
      code: "source_bytes_changed",
      detail: `./docs/a.md changed ./docs/b.md ${"x".repeat(500)}`.slice(0, 300),
      at: new Date(NOW).toISOString(),
    });
    expect(result.state.lastFailure!.detail).toHaveLength(300);
  });

  it("records the typed runtime failure message", async () => {
    const error = new KnowledgeConvergenceRuntimeError("knowledge_materialization_busy");
    expect((await cycle({ previous: null, error })).state.lastFailure).toMatchObject({
      code: error.code,
      detail: error.message,
    });
  });

  it.each([
    [Object.assign(new Error("native diagnostic"), { code: "native_failure" }), "native_failure"],
    [
      Object.assign(new Error("provider output"), {
        name: "ProviderExecutionError",
        code: "provider_failure",
      }),
      "provider_failure",
    ],
    [{ code: "provider_failure", message: "provider output" }, "provider_failure"],
    [new Error("native diagnostic"), "unclassified_failure"],
    [{ code: "ENOENT" }, "unclassified_failure"],
    [{ code: "ab" }, "unclassified_failure"],
    [{ code: `a${"b".repeat(81)}` }, "unclassified_failure"],
    [{ code: "abc" }, "abc"],
    [{ code: `a${"b".repeat(80)}` }, `a${"b".repeat(80)}`],
  ])("records only a stable code for native or provider error %#", async (error, code) => {
    expect((await cycle({ previous: null, error })).state.lastFailure).toEqual({
      code,
      detail: null,
      at: new Date(NOW).toISOString(),
    });
  });

  it("clears the failure after the next completed cycle", async () => {
    const failed = await cycle({ previous: null, fails: true });
    expect(failed.state.lastFailure).not.toBeNull();
    const completed = await cycle({ previous: { ...failed.state, nextReconcileAt: null } });
    expect(completed.outcome.kind).toBe("completed");
    expect(completed.state.lastFailure).toBeNull();
  });

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

  it("runs a due delivery without the fence, but no age alone forces a cycle", async () => {
    expect(await cycle({ previous: previous(), earliestAvailableAt: NOW })).toMatchObject({
      full: 1,
    });
    expect(
      await cycle({
        previous: previous({ lastCycleAt: new Date(NOW - CEILING).toISOString() }),
      }),
    ).toMatchObject({ full: 0 });
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

  it("backs off on a parked retry and wakes when its attempt falls due", async () => {
    const retry = (nextAttemptAt: number) => ({
      status: "processed" as const,
      outcomes: [],
      convergence: {
        transport: "ready" as const,
        debtCounts: { canonicalization: 0, normalization: 1, lifecycle: 0, historical: 0 },
        outstanding: 1,
        oldestAgeMilliseconds: 60_000,
        activeStage: "normalization_generation",
        state: "retry_scheduled",
        reason: "knowledge_job_transient_failure",
        retry: {
          attemptCount: 14,
          attemptLimit: 16,
          nextAttemptAt: new Date(nextAttemptAt).toISOString(),
        },
        lastVerifiedCurrency: null,
      },
    });
    // The fence saw the delivery due before the cycle attempted and rescheduled it.
    const parked = await cycle({
      previous: previous({ lastResult: "processed", idleStreak: 0 }),
      fingerprint: OTHER,
      earliestAvailableAt: NOW - 1_000,
      result: retry(NOW + 25 * 60_000),
    });
    expect(parked.state).toMatchObject({ lastResult: "idle", idleStreak: 1 });
    expect(parked.earliestAvailableAt).toBe(NOW + 25 * 60_000);
    const skipped = await cycle({
      previous: previous({ ...parked.state, lastCycleAt: new Date(NOW).toISOString() }),
      fingerprint: OTHER,
      earliestAvailableAt: NOW + 25 * 60_000,
      now: NOW + 60_000,
    });
    expect(skipped).toMatchObject({ outcome: { kind: "skipped" }, full: 0 });
    expect(
      residentReconcileDelay({
        idleStreak: 8,
        now: NOW + 20 * 60_000,
        earliestAvailableAt: parked.earliestAvailableAt,
        baseMilliseconds: BASE,
        ceilingMilliseconds: CEILING,
      }),
    ).toBe(5 * 60_000);
    // Once the attempt is due, the cycle that leaves it unclaimed is work, not idle.
    expect(
      await cycle({ previous: null, result: retry(NOW - 1), earliestAvailableAt: NOW - 1 }),
    ).toMatchObject({ state: { lastResult: "processed", idleStreak: 0 } });
  });
});

describe("held repositories, unbounded skips and failure backoff (ADR-0595, ADR-0602)", () => {
  const HELD = { status: "busy", reason: "repository_owner_hold" };
  const delay = (idleStreak: number) =>
    residentReconcileDelay({
      idleStreak,
      now: NOW,
      earliestAvailableAt: null,
      baseMilliseconds: BASE,
      ceilingMilliseconds: CEILING,
    });

  it("classifies a held repository as held, skips it unchanged, and backs it off", async () => {
    const held = await cycle({ previous: null, result: HELD });
    expect(held.state).toMatchObject({
      lastResult: "held",
      idleStreak: 1,
      fingerprint: FINGERPRINT,
    });
    let state = { ...held.state, nextReconcileAt: null };
    const delays = [delay(state.idleStreak)];
    for (let index = 1; index < 4; index++) {
      const next = await cycle({ previous: state, now: NOW + index * 1_000 });
      expect(next).toMatchObject({ outcome: { kind: "skipped" }, full: 0 });
      state = { ...next.state, nextReconcileAt: null };
      delays.push(delay(state.idleStreak));
    }
    expect(state.lastResult).toBe("held");
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000]);
    // A busy cycle that is not a hold, such as one that yielded to an upgrade, is still work.
    expect(
      await cycle({
        previous: null,
        result: { status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" },
      }),
    ).toMatchObject({ state: { lastResult: "processed", idleStreak: 0 } });
  });

  it("runs the held repository in full once the hold changes its fingerprint", async () => {
    const held = previous({ lastResult: "held", idleStreak: 6 });
    const released = await cycle({ previous: held, fingerprint: OTHER });
    expect(released).toMatchObject({
      full: 1,
      outcome: { kind: "completed" },
      state: { lastResult: "idle", fingerprint: OTHER },
    });
  });

  it("skips an unchanged fingerprint however old the last full cycle is (ADR-0602)", async () => {
    const at = (elapsed: number) =>
      cycle({ previous: previous({ lastCycleAt: new Date(NOW - elapsed).toISOString() }) });
    expect(await at(CEILING)).toMatchObject({ full: 0, outcome: { kind: "skipped" } });
    expect(await at(60 * 60_000)).toMatchObject({ full: 0, outcome: { kind: "skipped" } });
    expect(await at(30 * 86_400_000)).toMatchObject({ full: 0, outcome: { kind: "skipped" } });
    // A changed fingerprint, such as a new Hub change token, runs in full at once.
    expect(
      await cycle({
        previous: previous({ lastCycleAt: new Date(NOW).toISOString() }),
        fingerprint: OTHER,
      }),
    ).toMatchObject({ full: 1, outcome: { kind: "completed" } });
  });

  it("validates the failure retry cadence", () => {
    expect(residentCadence({})).toEqual({ base: BASE, ceiling: CEILING });
    expect(() =>
      residentCadence({ intervalMilliseconds: 1_000, reconcileCeilingMilliseconds: 999 }),
    ).toThrow("Invalid convergence reconciliation ceiling.");
  });

  it("backs repeated failures off without ever skipping them", async () => {
    let state: ResidentCycleState | null = null;
    const delays: number[] = [];
    for (let index = 0; index < 3; index++) {
      const failed = await cycle({ previous: state, fails: true });
      // A failure records no fingerprint, so the next observation always runs in full.
      expect(failed).toMatchObject({ full: 1, state: { lastResult: "failed", fingerprint: null } });
      state = { ...failed.state, nextReconcileAt: null };
      delays.push(delay(state.idleStreak));
    }
    expect(delays).toEqual([60_000, 120_000, 240_000]);
    expect(
      await cycle({ previous: { ...state!, fingerprint: FINGERPRINT }, fails: true }),
    ).toMatchObject({ full: 1 });
  });
});

describe("resident cycle state", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
  });

  it("persists the failure diagnostic and reads old state without lastFailure", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-cycle-"));
    directories.push(root);
    const result = await cycle({
      previous: null,
      error: new RepositoryKnowledgeError("source_bytes_changed", "/work/repo/docs/a.md changed"),
    });
    const failed = { ...result.state, nextReconcileAt: null };
    await writeResidentCycleState(root, failed);
    expect(await readResidentCycleState(root)).toEqual(failed);
    expect((await stat(resolve(root, RESIDENT_CYCLE_STATE_PATH))).size).toBeLessThanOrEqual(4_096);
    const legacy = previous();
    expect(legacy).not.toHaveProperty("lastFailure");
    await writeFile(resolve(root, RESIDENT_CYCLE_STATE_PATH), JSON.stringify(legacy));
    expect(await readResidentCycleState(root)).toEqual(legacy);
    const cleared = previous({ lastFailure: null });
    await writeResidentCycleState(root, cleared);
    expect(await readResidentCycleState(root)).toEqual(cleared);
  });

  it("rejects oversized state on both boundaries", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-cycle-"));
    directories.push(root);
    await writeResidentCycleState(root, previous());
    await writeFile(resolve(root, RESIDENT_CYCLE_STATE_PATH), " ".repeat(4_097));
    expect(await readResidentCycleState(root)).toBeNull();
    await expect(
      writeResidentCycleState(root, previous({ fingerprint: "x".repeat(4_097) })),
    ).rejects.toThrow("exceeds 4 KiB");
  });

  it("round-trips private state and treats missing or invalid state as absent", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-cycle-"));
    directories.push(root);
    expect(await readResidentCycleState(root)).toBeNull();
    const state = previous({ nextReconcileAt: new Date(NOW).toISOString() });
    await writeResidentCycleState(root, state);
    expect(await readResidentCycleState(root)).toEqual(state);
    expect((await stat(resolve(root, RESIDENT_CYCLE_STATE_PATH))).mode & 0o777).toBe(0o600);
    const held = previous({ lastResult: "held", idleStreak: 3 });
    await writeResidentCycleState(root, held);
    expect(await readResidentCycleState(root)).toEqual(held);
    for (const invalid of [
      "not json",
      JSON.stringify({ ...state, schemaVersion: 2 }),
      JSON.stringify({ ...state, fingerprint: "sha256:short" }),
      JSON.stringify({ ...state, lastResult: "current" }),
      JSON.stringify({ ...state, idleStreak: -1 }),
      JSON.stringify({ ...state, lastCycleAt: "yesterday" }),
      ...[
        { code: "Invalid", detail: null, at: new Date(NOW).toISOString() },
        { code: "valid_code", detail: "x".repeat(301), at: new Date(NOW).toISOString() },
        { code: "valid_code", detail: "two\nlines", at: new Date(NOW).toISOString() },
        { code: "valid_code", detail: null, at: null },
      ].map((lastFailure) => JSON.stringify({ ...state, lastFailure })),
    ]) {
      await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
      await writeFile(resolve(root, RESIDENT_CYCLE_STATE_PATH), invalid);
      expect(await readResidentCycleState(root)).toBeNull();
    }
  });
});
