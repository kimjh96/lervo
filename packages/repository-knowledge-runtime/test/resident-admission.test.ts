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

  it("heartbeats attention with the hold reason until stopped, then records stopped", async () => {
    vi.useFakeTimers();
    try {
      const record = vi.fn(async () => undefined);
      const stop = startKnowledgeResidentHold({
        repositoryRoot: "/repository",
        workerId: "cli-host-1",
        reason: "event_schema_outdated",
        onFailure: () => undefined,
        heartbeatMilliseconds: 1_000,
        record,
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await stop();
      await stop();
      await vi.advanceTimersByTimeAsync(5_000);
      const states = record.mock.calls.map((call) => (call as unknown as [{ state: string }])[0]);
      expect(states.slice(0, 3)).toEqual([
        expect.objectContaining({ state: "attention", reason: "event_schema_outdated" }),
        expect.objectContaining({ state: "attention", reason: "event_schema_outdated" }),
        expect.objectContaining({ state: "attention", reason: "event_schema_outdated" }),
      ]);
      expect(states.at(-1)).toEqual(expect.objectContaining({ state: "stopped", reason: null }));
      expect(states).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed heartbeat without stopping the hold", async () => {
    vi.useFakeTimers();
    try {
      const failures: unknown[] = [];
      const record = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("disk full"))
        .mockResolvedValue(undefined);
      const stop = startKnowledgeResidentHold({
        repositoryRoot: "/repository",
        workerId: "node-1",
        reason: "event_schema_outdated",
        onFailure: (error) => failures.push(error),
        heartbeatMilliseconds: 1_000,
        record,
      });
      await vi.advanceTimersByTimeAsync(1_500);
      await stop();
      expect(failures).toHaveLength(1);
      expect(record).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
