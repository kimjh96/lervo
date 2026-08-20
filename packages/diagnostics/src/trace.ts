import type { EventStore } from "@lervo/storage-contract";

import { readTraceReport, traceReportSchemaVersion } from "./trace-report-contract.js";
import { DiagnosticsError, type TraceReport, type TraceSelector } from "./types.js";

export const maximumTraceReportEvents = 1000;

export function createTraceReport(input: {
  projectId: string;
  events: EventStore;
  selector: TraceSelector;
}): TraceReport {
  const integrity = input.events.verifyIntegrity();
  const latestEvent = input.events.latest();
  if (latestEvent === null) {
    throw new DiagnosticsError("trace_empty", "추적할 로컬 event가 없습니다.");
  }
  const runId = input.selector === "last"
    ? latestEvent.runId
    : input.selector;
  const events = input.events.list({ runId, limit: maximumTraceReportEvents });
  if (events.length === 0) {
    throw new DiagnosticsError(
      "trace_run_not_found",
      `요청한 run ID의 event가 없습니다: ${runId}`,
    );
  }
  const lastEvent = events.at(-1)!;
  if (
    events.length === maximumTraceReportEvents &&
    input.events.list({ runId, afterSeq: lastEvent.seq, limit: 1 }).length > 0
  ) {
    throw new DiagnosticsError(
      "trace_result_too_large",
      `한 번에 표시할 수 있는 event ${maximumTraceReportEvents}개를 넘었습니다.`,
    );
  }
  const types = new Set(events.map((event) => event.type));
  const status = types.has("run.failed")
    ? "failed"
    : types.has("run.completed") || types.has("deliberation.completed")
      ? "completed"
      : "incomplete";
  return readTraceReport({
    schemaVersion: traceReportSchemaVersion,
    projectId: input.projectId,
    runId,
    status,
    integrity,
    firstOccurredAt: events[0]!.occurredAt,
    lastOccurredAt: events.at(-1)!.occurredAt,
    sessionIds: [...new Set(events.map((event) => event.sessionId))],
    events,
  });
}
