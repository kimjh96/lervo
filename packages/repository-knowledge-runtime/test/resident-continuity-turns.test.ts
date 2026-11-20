import { expect, it, vi } from "vitest";

import type { ConvergenceContinuity } from "../src/convergence-continuity.js";
import { continuityTurnDueAt, residentContinuityTurns } from "../src/resident-continuity-turns.js";

const past = new Date(Date.now() - 60_000).toISOString();

function turns(outcomes: { status: "busy" | "reconciled"; state: unknown }[], running: boolean) {
  const due: (number | null)[] = [];
  const turn = vi.fn(async () => outcomes.shift() ?? { status: "reconciled", state: null });
  const control = residentContinuityTurns({
    continuity: { turn } as unknown as ConvergenceContinuity,
    signal: new AbortController().signal,
    held: async () => false,
    cycleRunning: () => running,
    onDue: (at) => due.push(at),
    onFailure: () => undefined,
  });
  return { control, due, turn };
}

it("sets no deadline for a lock its own cycle holds, and turns again once the cycle ends (ADR-0602)", async () => {
  const { control, due, turn } = turns(
    [{ status: "busy", state: { nextReconcileAt: past } }],
    true,
  );
  await control.run();
  // The last state's passed deadline is never read as a reason to look again at once.
  expect(due).toEqual([null]);
  control.afterCycle();
  await control.settled();
  expect(turn).toHaveBeenCalledTimes(2);
  control.afterCycle();
  await control.settled();
  expect(turn).toHaveBeenCalledTimes(2);
});

it("backs off from the retry bound for another process's lock (ADR-0602)", async () => {
  const busy = { status: "busy" as const, state: { nextReconcileAt: past } };
  const { control, due } = turns([busy, busy], false);
  const now = Date.now();
  await control.run();
  await control.run();
  expect(due[0]! - now).toBeGreaterThanOrEqual(15 * 60_000);
  expect(due[1]! - now).toBeGreaterThanOrEqual(30 * 60_000);
});

it("reads a turn's due time, falling back to the retry bound only for an unreadable one", () => {
  const now = 1_000_000;
  expect(continuityTurnDueAt({ nextReconcileAt: null }, now)).toBeNull();
  expect(continuityTurnDueAt({ nextReconcileAt: "not a time" }, now)).toBe(now + 15 * 60_000);
  expect(continuityTurnDueAt({ nextReconcileAt: new Date(now + 5_000).toISOString() }, now)).toBe(
    now + 5_000,
  );
});
