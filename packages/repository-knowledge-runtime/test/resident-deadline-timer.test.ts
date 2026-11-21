import { afterEach, expect, it, vi } from "vitest";

import { ResidentDeadlineTimer } from "../src/resident-deadline-timer.js";
import { residentNextCycleAt, residentReconcileAt } from "../src/resident-cycle.js";

afterEach(() => vi.useRealTimers());

function timer() {
  vi.useFakeTimers({ now: 1_000_000 });
  const fired: string[][] = [];
  const refused: string[] = [];
  const deadlines = new ResidentDeadlineTimer<"a" | "b">(
    (due) => fired.push(due),
    Date.now,
    (name) => refused.push(name),
  );
  return { deadlines, fired, refused };
}

it("arms no timer without a deadline, for NaN, or for Infinity", () => {
  const { deadlines } = timer();
  expect(vi.getTimerCount()).toBe(0);
  deadlines.set("a", Number.NaN);
  deadlines.set("b", Number.POSITIVE_INFINITY);
  expect(vi.getTimerCount()).toBe(0);
  deadlines.set("a", Date.now() + 1_000);
  expect(vi.getTimerCount()).toBe(1);
  deadlines.set("a", null);
  expect(vi.getTimerCount()).toBe(0);
});

it("fires one timer for the earliest of several deadlines, each name once", async () => {
  const { deadlines, fired } = timer();
  deadlines.set("a", Date.now() + 5_000);
  deadlines.set("b", Date.now() + 2_000);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fired).toEqual([["b"]]);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(fired).toEqual([["b"], ["a"]]);
  expect(vi.getTimerCount()).toBe(0);
});

it("fires a past deadline at once, and refuses it when set again unchanged (ADR-0602)", async () => {
  const { deadlines, fired, refused } = timer();
  const past = Date.now() - 1;
  deadlines.set("a", past);
  await vi.advanceTimersByTimeAsync(0);
  expect(fired).toEqual([["a"]]);
  // The handler hands back the same past moment: re-firing would spin, so it is refused.
  deadlines.set("a", past);
  expect(refused).toEqual(["a"]);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fired).toEqual([["a"]]);
  // A later moment arms again.
  deadlines.set("a", Date.now() + 1_000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(fired).toEqual([["a"], ["a"]]);
});

it("waits out a deadline beyond the 2^31-1 ms timer limit without firing early", async () => {
  const { deadlines, fired } = timer();
  const at = Date.now() + 30 * 86_400_000;
  deadlines.set("a", at);
  await vi.advanceTimersByTimeAsync(2_147_483_647);
  expect(fired).toEqual([]);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(at - Date.now());
  expect(fired).toEqual([["a"]]);
});

it("never fires early when the wall clock steps back (ADR-0602)", async () => {
  const { deadlines, fired } = timer();
  deadlines.set("a", Date.now() + 10_000);
  // The wall clock steps back a minute; the monotonic timer still expires after 10 s, finds the
  // deadline not yet due by the wall clock, and re-arms for the rest.
  vi.setSystemTime(Date.now() - 60_000);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fired).toEqual([]);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fired).toEqual([["a"]]);
});

it("has no reconcile deadline when nothing is due, and only due times otherwise (ADR-0602)", () => {
  const now = 1_000_000;
  expect(residentReconcileAt({ now, earliestAvailableAt: null, observedAt: now })).toBe(
    Number.POSITIVE_INFINITY,
  );
  expect(residentReconcileAt({ now, earliestAvailableAt: now + 90_000, observedAt: now })).toBe(
    now + 90_000,
  );
  // Already due when observed: deferred work waits for a change, never loops.
  expect(residentReconcileAt({ now, earliestAvailableAt: now - 5, observedAt: now })).toBe(
    Number.POSITIVE_INFINITY,
  );
  // Fell due while the cycle ran: one more look a second later.
  expect(residentReconcileAt({ now, earliestAvailableAt: now - 5, observedAt: now - 10 })).toBe(
    now + 1_000,
  );
  const next = (input: { lastResult: "idle" | "failed"; unverifiable?: boolean }) =>
    residentNextCycleAt({
      now,
      cycle: {
        state: {
          lastCycleAt: new Date(now).toISOString(),
          lastResult: input.lastResult,
          idleStreak: 3,
        },
        earliestAvailableAt: null,
        observedAt: now,
      },
      unverifiable: input.unverifiable ?? false,
      publicationRetryAfterMs: null,
      baseMilliseconds: 60_000,
      ceilingMilliseconds: 900_000,
    });
  expect(next({ lastResult: "idle" })).toBe(Number.POSITIVE_INFINITY);
  // Failures and unverifiable ownership retry with a growing delay to the ceiling.
  expect(next({ lastResult: "failed" })).toBe(now + 240_000);
  expect(next({ lastResult: "idle", unverifiable: true })).toBe(now + 240_000);
});
