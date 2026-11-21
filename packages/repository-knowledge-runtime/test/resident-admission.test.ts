import { describe, expect, it, vi } from "vitest";

import {
  KNOWLEDGE_RESIDENT_EVENT_SCHEMA_VERSION,
  knowledgeResidentHoldReason,
  startKnowledgeResidentHold,
} from "../src/resident-admission.js";

describe("knowledge resident admission", () => {
  it("holds every writer older than the resident's event schema and admits the rest", () => {
    expect(KNOWLEDGE_RESIDENT_EVENT_SCHEMA_VERSION).toBe(4);
    expect(knowledgeResidentHoldReason(undefined)).toBe("event_schema_outdated");
    for (const version of [1, 2, 3])
      expect(knowledgeResidentHoldReason(version)).toBe("event_schema_outdated");
    expect(knowledgeResidentHoldReason(4)).toBeNull();
  });

  it("records attention once with its presence, arms no timer, then records stopped (ADR-0602)", async () => {
    vi.useFakeTimers();
    try {
      const record = vi.fn(async () => undefined);
      const stop = startKnowledgeResidentHold({
        repositoryRoot: "/repository",
        workerId: "cli-host-1",
        reason: "event_schema_outdated",
        onFailure: () => undefined,
        record,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(record).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await stop();
      await stop();
      const states = record.mock.calls.map(
        (call) => (call as unknown as [{ state: string; presence: string }])[0],
      );
      expect(states).toEqual([
        expect.objectContaining({
          state: "attention",
          reason: "event_schema_outdated",
          presence: expect.any(String),
        }),
        expect.objectContaining({ state: "stopped", reason: null }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed record with a growing delay without stopping the hold", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Real I/O (the presence listening) settles on setImmediate, which stays real here.
    const calls = async (count: number) => {
      for (let turn = 0; turn < 500 && record.mock.calls.length < count; turn++)
        await new Promise((settle) => setImmediate(settle));
      return record.mock.calls.length;
    };
    const failures: unknown[] = [];
    const record = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    try {
      const stop = startKnowledgeResidentHold({
        repositoryRoot: "/repository",
        workerId: "node-1",
        reason: "event_schema_outdated",
        onFailure: (error) => failures.push(error),
        record,
      });
      expect(await calls(1)).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await calls(2)).toBe(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(record).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await calls(3)).toBe(3);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(record).toHaveBeenCalledTimes(3);
      await stop();
      expect(failures).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
