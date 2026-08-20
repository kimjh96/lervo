import type { EventStore } from "@lervo/storage-contract";

import { readTraceReport, traceReportSchemaVersion } from "./trace-report-contract.js";
import { DiagnosticsError, type TraceReport, type TraceSelector } from "./types.js";

export function createTraceReport(input: {
  projectId: string;
  events: EventStore;
  selector: TraceSelector;
}): TraceReport {
  const allEvents = input.events.list();
  if (allEvents.length === 0) {
    throw new DiagnosticsError("trace_empty", "추적할 로컬 event가 없습니다.");
  }
  const runId = input.selector === "last"
    ? allEvents.at(-1)!.runId
    : input.selector;
  const events = allEvents.filter((event) => event.runId === runId);
  if (events.length === 0) {
    throw new DiagnosticsError(
      "trace_run_not_found",
      `요청한 run ID의 event가 없습니다: ${runId}`,
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
    integrity: input.events.verifyIntegrity(),
    firstOccurredAt: events[0]!.occurredAt,
    lastOccurredAt: events.at(-1)!.occurredAt,
    sessionIds: [...new Set(events.map((event) => event.sessionId))],
    events,
  });
}
