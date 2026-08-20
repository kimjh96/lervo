import { computeEventHash } from "@lervo/event-contract";
import {
  createTraceReport,
  maximumTraceReportEvents,
} from "@lervo/diagnostics";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore, ListEventsOptions } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

function events(count: number, runIdAt: (index: number) => string): EventEnvelope[] {
  const output: EventEnvelope[] = [];
  let previousHash: string | null = null;
  for (let index = 1; index <= count; index += 1) {
    const withoutHash: Omit<EventEnvelope, "eventHash"> = {
      eventId: `evt_trace_bound_${String(index).padStart(8, "0")}`,
      projectId: "prj_01234567",
      runId: runIdAt(index),
      sessionId: "ses_01234567",
      seq: index,
      type: "run.requested" as const,
      occurredAt: `2026-08-20T00:${String(Math.floor(index / 60) % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
      actor: { kind: "system" as const },
      schemaVersion: 1 as const,
      policyVersion: `sha256:${"a".repeat(64)}`,
      payload: {
        requestDigest: `sha256:${"b".repeat(64)}`,
        role: "developer",
        risk: "low",
      },
      previousHash,
    };
    const event: EventEnvelope = {
      ...withoutHash,
      eventHash: computeEventHash(withoutHash),
    };
    output.push(event);
    previousHash = event.eventHash;
  }
  return output;
}

function eventStore(source: EventEnvelope[]): EventStore {
  const list = vi.fn((options: ListEventsOptions = {}) => source
    .filter((event) => options.runId === undefined || event.runId === options.runId)
    .filter((event) => event.seq > (options.afterSeq ?? 0))
    .slice(0, options.limit ?? 100));
  return {
    latest: () => source.at(-1) ?? null,
    list,
    verifyIntegrity: () => ({
      valid: true,
      eventCount: source.length,
      headHash: source.at(-1)?.eventHash ?? null,
    }),
  } as unknown as EventStore;
}

describe("bounded trace source reads", () => {
  it("selects last from the actual head instead of the default 100-event page", () => {
    const source = events(101, (index) =>
      index === 101 ? "run_latest_0001" : "run_earlier_001");
    const store = eventStore(source);

    const report = createTraceReport({
      projectId: "prj_01234567",
      events: store,
      selector: "last",
    });

    expect(report.runId).toBe("run_latest_0001");
    expect(report.events).toHaveLength(1);
    expect(store.list).toHaveBeenCalledWith({
      runId: "run_latest_0001",
      limit: maximumTraceReportEvents,
    });
  });

  it("fails explicitly instead of returning a truncated full report", () => {
    const source = events(maximumTraceReportEvents + 1, () => "run_oversize_01");

    expect(() => createTraceReport({
      projectId: "prj_01234567",
      events: eventStore(source),
      selector: "run_oversize_01",
    })).toThrowError(expect.objectContaining({ code: "trace_result_too_large" }));
  });
});
