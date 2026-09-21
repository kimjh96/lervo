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
});
