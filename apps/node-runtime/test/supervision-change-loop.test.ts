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
      nextAuthorityCheckAt: () => deadline,
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(cycle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(2);
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
      nextAuthorityCheckAt: () => null,
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
      nextAuthorityCheckAt: () => due,
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

  it("backs off an inactive standing workstream while retaining event wakeup", async () => {
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
      nextAuthorityCheckAt: () => null,
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

  it("backs a lapsed progress deadline off to five minutes and resets on an event hint", async () => {
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
      nextAuthorityCheckAt: () => null,
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    // The first evaluation records the source; later identical evaluations back off.
    await vi.advanceTimersByTimeAsync(5_000 + 5_000 + 10_000 + 20_000 + 40_000 + 80_000);
    await vi.advanceTimersByTimeAsync(160_000 + 300_000 + 300_000);
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
    expect(gaps).toEqual([5_000, 5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    starts.length = 0;
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(starts).toHaveLength(2);
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
      nextAuthorityCheckAt: () => null,
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(cycle).toHaveBeenCalledTimes(6);
    await loop.stop();
  });

  it("does not back off while the owner lease is busy or an effect changed the source", async () => {
    vi.useFakeTimers();
    const lapsed = report(new Date(Date.now() - 1_000).toISOString());
    const cycle = vi
      .fn()
      .mockResolvedValueOnce({ disposition: "idle", report: lapsed })
      .mockResolvedValueOnce({ disposition: "idle", report: lapsed })
      .mockResolvedValueOnce({ disposition: "busy", report: null })
      .mockResolvedValueOnce({ disposition: "effect_confirmed", report: lapsed })
      .mockResolvedValue({ disposition: "idle", report: lapsed });
    const loop = createSupervisionChangeLoop({
      runCycle: cycle,
      subscribe: () => () => {},
      nextAuthorityCheckAt: () => null,
      onFailure: vi.fn(),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    // idle (record) 5 s, idle (same) 5 s, busy 5 s, effect 5 s, idle (record) 5 s, idle 5 s, 10 s.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cycle).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(cycle).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(8);
    await loop.stop();
  });
});
