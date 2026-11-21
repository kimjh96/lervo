import type { OutcomeSupervisionReportV1 } from "@lervo/application-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupervisionChangeLoop } from "../src/supervision-change-loop.js";

afterEach(() => vi.useRealTimers());

function report(nextCheckAt: string | null): OutcomeSupervisionReportV1 {
  return {
    schemaVersion: 1,
    kind: "work.supervision.report",
    supervisionId: "supervision.fixture",
    ownerAgentId: `agt_${"a".repeat(24)}`,
    sourceRevisionDigest: `sha256:${"a".repeat(64)}`,
    causationEventIds: [],
    status: "awaiting_start",
    reasonCode: "awaiting_worker_evidence",
    assignmentIds: [],
    nextCheckAt,
    nextAction: null,
  };
}

describe("supervision event and deadline scheduling", () => {
  it("wakes an initially deferred owner without a source notification or report", async () => {
    vi.useFakeTimers();
    let deadline: number | null = null;
    const cycle = vi.fn(async () => {
      deadline = cycle.mock.calls.length === 1 ? Date.now() + 60_000 : null;
      return { disposition: "idle" as const, report: null };
    });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: () => () => {},
      dutyDeadlines: () => [deadline],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(cycle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("still wakes a deferred owner whose first cycle outlasted the startup grace", async () => {
    vi.useFakeTimers();
    let deadline: number | null = null;
    const cycle = vi.fn(async () => {
      if (cycle.mock.calls.length === 1) {
        deadline = Date.now() + 60_000;
        // The first cycle's own work, such as opening a large history, runs past the grace.
        await new Promise((done) => setTimeout(done, 65_000));
      } else deadline = null;
      return { disposition: "idle" as const, report: null };
    });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: () => () => {},
      dutyDeadlines: () => [deadline],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(65_000);
    expect(cycle).toHaveBeenCalledOnce();
    // The lapsed grace gets its one extra cycle, which evaluates the source.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cycle).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("arms a later deadline while an earlier one stays lapsed", async () => {
    vi.useFakeTimers();
    const lapsed = Date.now() - 1_000;
    const later = Date.now() + 30_000;
    const cycle = vi.fn(async () => ({ disposition: "idle" as const, report: null }));
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: () => () => {},
      // An expired mandate stays reported; it must not hide the next check.
      dutyDeadlines: () => [lapsed, later],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(cycle).toHaveBeenCalledOnce();
    // One extra cycle for the lapsed deadline, and no more.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(3);
    await loop.stop();
  });

  it("preserves a durable deadline across idle reports and coalesced event hints", async () => {
    vi.useFakeTimers();
    let notify = () => {};
    const unsubscribe = vi.fn();
    const cycle = vi
      .fn()
      .mockResolvedValueOnce({
        disposition: "idle",
        report: report(new Date(Date.now() + 500).toISOString()),
      })
      .mockResolvedValue({ disposition: "idle", report: null });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: (callback) => {
        notify = callback;
        return unsubscribe;
      },
      dutyDeadlines: () => [null],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    notify();
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(cycle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(cycle).toHaveBeenCalledTimes(3);
    await loop.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("schedules the earlier authority audit and retains bounded failure retry", async () => {
    vi.useFakeTimers();
    const due = Date.now() + 200;
    const failure = vi.fn();
    const cycle = vi
      .fn()
      .mockResolvedValueOnce({
        disposition: "idle",
        report: report(new Date(Date.now() + 1000).toISOString()),
      })
      .mockRejectedValueOnce(new Error("authority unavailable"))
      .mockResolvedValue({ disposition: "idle", report: report(null) });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: () => () => {},
      dutyDeadlines: () => [due],
      onFailure: failure,
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(failure).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4999);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(3);
    await loop.stop();
  });

  it("keeps an inactive standing workstream asleep while retaining event wakeup", async () => {
    vi.useFakeTimers();
    let notify = () => {};
    const cycle = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("inactive"), { code: "supervision_workstream_inactive" }),
      )
      .mockResolvedValue({ disposition: "idle", report: report(null) });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: (callback) => {
        notify = callback;
        return () => {};
      },
      dutyDeadlines: () => [null],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(cycle).toHaveBeenCalledOnce();
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(cycle).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("gives a lapsed progress deadline one more cycle, then waits for an event hint (ADR-0602)", async () => {
    vi.useFakeTimers();
    let notify = () => {};
    const lapsed = report(new Date(Date.now() - 1_000).toISOString());
    const starts: number[] = [];
    const cycle = vi.fn(async () => {
      starts.push(Date.now());
      return { disposition: "idle" as const, report: lapsed };
    });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: (callback) => {
        notify = callback;
        return () => {};
      },
      dutyDeadlines: () => [null],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    // The lapsed deadline's one extra cycle five seconds later, then nothing for a day.
    expect(starts.slice(1).map((start, index) => start - starts[index]!)).toEqual([5_000]);
    expect(vi.getTimerCount()).toBe(0);
    starts.length = 0;
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(1);
    // The same lapsed deadline already had its extra cycle.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(1);
    await loop.stop();
  });

  it("keeps the five-second retry while a lapsed deadline keeps changing the source", async () => {
    vi.useFakeTimers();
    let revision = 0;
    const cycle = vi.fn(async () => {
      revision += 1;
      return {
        disposition: "idle" as const,
        report: {
          ...report(new Date(Date.now() - 1_000).toISOString()),
          sourceRevisionDigest: `sha256:${String(revision).padStart(64, "0")}`,
        },
      };
    });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: () => () => {},
      dutyDeadlines: () => [null],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(cycle).toHaveBeenCalledTimes(6);
    await loop.stop();
  });

  it("settles an inactive workstream with no timer until a hint arrives (ADR-0602)", async () => {
    vi.useFakeTimers();
    let notify = () => {};
    const cycle = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("inactive"), { code: "supervision_workstream_inactive" }),
      )
      .mockResolvedValue({ disposition: "idle", report: report(null) });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: (callback) => {
        notify = callback;
        return () => {};
      },
      dutyDeadlines: () => [null],
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(cycle).toHaveBeenCalledOnce();
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(cycle).toHaveBeenCalledTimes(2);
    await loop.stop();
  });
});
