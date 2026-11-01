import { collectWorkExecutionEvents, createWorkExecutionReport } from "@lervo/diagnostics";
import { projectWorkExecutionReport } from "@lervo/execution-observability";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { describe, expect, it } from "vitest";

import {
  listedEvents,
  longHistoryEvents,
} from "../../storage-contract/test/listed-event-source.fixture.js";

const projectId = "prj_work_history";
const workId = `wrk_${"1".repeat(24)}`;
const otherWorkId = `wrk_${"2".repeat(24)}`;
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function event(
  seq: number,
  type: string,
  runId: string,
  payload: Record<string, unknown> = {},
): EventEnvelope {
  return {
    eventId: `evt_work_history_${String(seq).padStart(4, "0")}`,
    projectId,
    runId,
    sessionId: `ses_${runId.slice(4)}`,
    seq,
    type,
    occurredAt: `2026-09-20T00:00:${String(seq).padStart(2, "0")}.000Z`,
    actor: { kind: "system" },
    schemaVersion: type === "work.causality.recorded" ? 2 : 1,
    policyVersion: hash("a"),
    payload,
    previousHash: seq === 1 ? null : hash("b"),
    eventHash: hash(String(seq % 10)),
  } as EventEnvelope;
}

function causality(seq: number, runId: string, payload: Record<string, unknown>) {
  return event(seq, "work.causality.recorded", runId, {
    executionContractVersion: 1,
    relationship: "root",
    parentRunId: null,
    retryOfRunId: null,
    attemptOrdinal: 1,
    workstreamId: null,
    assignmentId: null,
    agentId: null,
    ...payload,
  });
}

function history(): EventEnvelope[] {
  return [
    causality(1, "run_work_root", { workId }),
    event(2, "run.requested", "run_work_root"),
    causality(3, "run_other_root", { workId: otherWorkId }),
    event(4, "run.requested", "run_other_root"),
    causality(5, "run_work_child", {
      workId,
      relationship: "subagent",
      parentRunId: "run_work_root",
    }),
    event(6, "run.completed", "run_work_child"),
    event(7, "run.completed", "run_work_root"),
    event(8, "run.completed", "run_other_root"),
  ];
}

function store(events: readonly EventEnvelope[], list = listedEvents(events)): EventStore {
  const head = events.reduce<EventEnvelope | null>(
    (latest, event) => (latest === null || event.seq > latest.seq ? event : latest),
    null,
  );
  return { list, latest: () => head } as unknown as EventStore;
}

describe("work execution trace history reads", () => {
  it("reads every run through one pinned head and bounds only events inside it", () => {
    const events = history();
    const pinned = Math.max(...events.map((event) => event.seq));
    const later = { ...events[0]!, seq: pinned + 1, eventId: "evt_later_causal_000001" };
    const all = [
      ...events,
      later,
      { ...later, seq: pinned + 2, eventId: "evt_later_causal_000002" },
    ];
    const read = collectWorkExecutionEvents({
      events: store(all),
      workId,
      throughSeq: pinned,
      maximumEvents: events.length,
    });
    expect(read.every((event) => event.seq <= pinned)).toBe(true);
  });

  it("reports one work beyond 100,000 events from its causal records and runs alone", () => {
    const long = longHistoryEvents(history());
    const report = createWorkExecutionReport({
      projectId,
      events: store(long.events, long.list),
      workId,
    });

    expect(report.runs.map((run) => [run.runId, run.status])).toEqual([
      ["run_work_root", "completed"],
      ["run_work_child", "completed"],
    ]);
    expect(report).toEqual(
      projectWorkExecutionReport({ projectId, workId, events: long.events.slice(0, -1) }),
    );
  });

  it("reads exactly the causal records and the work's run events", () => {
    const source = history();
    expect(
      collectWorkExecutionEvents({ events: store(source), workId }).map((item) => item.seq),
    ).toEqual([1, 2, 3, 5, 6, 7]);
    expect(
      collectWorkExecutionEvents({ events: store(source), workId, throughSeq: 6 }).map(
        (item) => item.seq,
      ),
    ).toEqual([1, 2, 3, 5, 6]);
  });

  it("still fails closed on a causal conflict in another work", () => {
    const conflicting = [...history(), causality(9, "run_other_root", { workId: otherWorkId })];
    const long = longHistoryEvents(conflicting);
    expect(() =>
      createWorkExecutionReport({ projectId, events: store(long.events, long.list), workId }),
    ).toThrowError(expect.objectContaining({ code: "causality_conflict" }));
  });

  it("counts a causal record that its run read returns again only once against the bound", () => {
    const exact = [
      causality(1, "run_work_root", { workId }),
      event(2, "run.requested", "run_work_root"),
      event(3, "run.completed", "run_work_root"),
    ];
    expect(
      collectWorkExecutionEvents({ events: store(exact), workId, maximumEvents: 3 }).map(
        (item) => item.seq,
      ),
    ).toEqual([1, 2, 3]);
    const over = [...exact, event(4, "adapter.completed", "run_work_root")];
    expect(() =>
      collectWorkExecutionEvents({ events: store(over), workId, maximumEvents: 3 }),
    ).toThrowError(expect.objectContaining({ code: "event_limit_exceeded" }));
  });

  it("bounds what it retains and keeps unknown work distinct", () => {
    expect(() =>
      collectWorkExecutionEvents({ events: store(history()), workId, maximumEvents: 3 }),
    ).toThrowError(expect.objectContaining({ code: "event_limit_exceeded" }));
    expect(() =>
      createWorkExecutionReport({
        projectId,
        events: store(history()),
        workId: `wrk_${"3".repeat(24)}`,
      }),
    ).toThrowError(expect.objectContaining({ code: "trace_work_not_found" }));
  });
});
