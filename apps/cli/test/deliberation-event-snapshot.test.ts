import type { EventEnvelope } from "@lervo/schemas";

import { describe, expect, it, vi } from "vitest";

import { readDeliberationEventSnapshot } from "../src/deliberation-event-snapshot.js";

function event(input: {
  seq: number;
  runId: string;
  type?: EventEnvelope["type"];
  deliberationId?: string;
}): EventEnvelope {
  const type = input.type ?? "run.started";
  const payload =
    type === "deliberation.started"
      ? { deliberationId: input.deliberationId }
      : type === "deliberation.artifact.recorded"
        ? { deliberationId: input.deliberationId }
        : type === "deliberation.completed"
          ? { deliberationId: input.deliberationId, status: "converged" }
          : {};
  return {
    seq: input.seq,
    eventId: `evt_${String(input.seq).padStart(8, "0")}`,
    runId: input.runId,
    type,
    payload,
  } as EventEnvelope;
}

function reader(source: readonly EventEnvelope[]) {
  return vi.fn((options?: { afterSeq?: number; limit?: number }) => {
    const afterSeq = options?.afterSeq ?? 0;
    const limit = options?.limit ?? 100;
    return source.filter((item) => item.seq > afterSeq).slice(0, limit);
  });
}

describe("deliberation event snapshot scan", () => {
  it("pages a fixed event snapshot without retaining unrelated project history", () => {
    const deliberationId = "dlb_snapshot01";
    const source = Array.from({ length: 2_504 }, (_, index) =>
      event({
        seq: index + 1,
        runId: `run_unrelated_${String(index + 1).padStart(8, "0")}`,
      }),
    );
    source[1_099] = event({
      seq: 1_100,
      runId: "run_deliberation01",
      type: "deliberation.started",
      deliberationId,
    });
    source[1_100] = event({
      seq: 1_101,
      runId: "run_deliberation01",
      type: "deliberation.artifact.recorded",
      deliberationId,
    });
    source[1_101] = event({
      seq: 1_102,
      runId: "run_deliberation01",
      type: "deliberation.completed",
      deliberationId,
    });
    source[2_199] = event({ seq: 2_200, runId: "run_checkpoint01" });
    source[2_503] = event({ seq: 2_504, runId: "run_deliberation01" });
    const list = reader(source);

    const snapshot = readDeliberationEventSnapshot({
      events: { list },
      eventCount: 2_503,
      deliberationId,
      checkpointEventIds: new Set(["evt_00002200"]),
      checkpointRunIds: new Set(),
    });

    expect(snapshot.started).toHaveLength(1);
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.completed).toHaveLength(1);
    expect(snapshot.traceEvents.map((item) => item.seq)).toEqual([1_100, 1_101, 1_102, 2_200]);
    expect(list).toHaveBeenCalledTimes(6);
    expect(
      list.mock.calls.every(
        ([options]) =>
          options !== undefined && options.limit !== undefined && options.limit <= 1_000,
      ),
    ).toBe(true);
  });

  it("fails before returning a partial trace when a related run exceeds the bound", () => {
    const deliberationId = "dlb_snapshot02";
    const source = Array.from({ length: 1_001 }, (_, index) =>
      event({
        seq: index + 1,
        runId: "run_deliberation02",
        type: index === 0 ? "deliberation.started" : "deliberation.artifact.recorded",
        deliberationId,
      }),
    );

    expect(() =>
      readDeliberationEventSnapshot({
        events: { list: reader(source) },
        eventCount: source.length,
        deliberationId,
        checkpointEventIds: new Set(),
        checkpointRunIds: new Set(),
      }),
    ).toThrow("more than 1,000 events");
  });

  it("rejects checkpoint evidence outside the fixed snapshot", () => {
    const source = [
      event({
        seq: 1,
        runId: "run_deliberation03",
        type: "deliberation.started",
        deliberationId: "dlb_snapshot03",
      }),
    ];

    expect(() =>
      readDeliberationEventSnapshot({
        events: { list: reader(source) },
        eventCount: 1,
        deliberationId: "dlb_snapshot03",
        checkpointEventIds: new Set(["evt_00000002"]),
        checkpointRunIds: new Set(),
      }),
    ).toThrow("do not match the current snapshot");
  });
});
