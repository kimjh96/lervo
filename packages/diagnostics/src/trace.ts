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
    throw new DiagnosticsError("trace_empty", "There are no local events to trace.");
  }
  const runId = input.selector === "last"
    ? latestEvent.runId
    : input.selector;
  const events = input.events.list({ runId, limit: maximumTraceReportEvents });
  if (events.length === 0) {
    throw new DiagnosticsError(
      "trace_run_not_found",
      `There are no events for the requested run ID: ${runId}`,
    );
  }
  const lastEvent = events.at(-1)!;
  if (
    events.length === maximumTraceReportEvents &&
    input.events.list({ runId, afterSeq: lastEvent.seq, limit: 1 }).length > 0
  ) {
    throw new DiagnosticsError(
      "trace_result_too_large",
      `The maximum of ${maximumTraceReportEvents} events that can be displayed at once was exceeded.`,
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
