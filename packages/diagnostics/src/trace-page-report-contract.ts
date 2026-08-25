import { readVersionedReport } from "./report-compatibility.js";
import { decodeTraceCursor } from "./trace-cursor.js";
import { areTraceEventsValid } from "./trace-report-semantics.js";
import type { TracePageReport } from "./types.js";

export const tracePageReportSchemaVersion = 1 as const;

export type TracePageReportCompatibilityErrorCode =
  "trace_page_report_invalid" | "trace_page_report_schema_unsupported";

export class TracePageReportCompatibilityError extends Error {
  constructor(
    readonly code: TracePageReportCompatibilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TracePageReportCompatibilityError";
  }
}

function pageSemanticsAreValid(report: TracePageReport): boolean {
  const { page, events } = report;
  const first = events[0]!;
  const last = events.at(-1)!;
  if (
    page.returnedCount !== events.length ||
    report.integrity.eventCount < last.seq ||
    (report.integrity.eventCount === last.seq && report.integrity.headHash !== last.eventHash) ||
    first.seq <= page.afterSeq ||
    (page.afterSeq === 0) !== (page.afterEventHash === null) ||
    (first.seq === page.afterSeq + 1 &&
      page.afterEventHash !== null &&
      first.previousHash !== page.afterEventHash) ||
    page.hasMore !== (page.nextCursor !== null)
  ) {
    return false;
  }
  if (
    report.filter !== undefined &&
    (events.some((event) => !report.filter!.eventTypes.includes(event.type)) ||
      report.filter.eventTypes.some(
        (eventType, index) => index > 0 && report.filter!.eventTypes[index - 1]! >= eventType,
      ))
  ) {
    return false;
  }
  if (page.nextCursor === null) return true;
  const cursor = decodeTraceCursor(page.nextCursor);
  const filterEventTypes = report.filter?.eventTypes;
  return (
    cursor !== null &&
    cursor.projectId === report.projectId &&
    cursor.runId === report.runId &&
    cursor.eventCount === report.integrity.eventCount &&
    cursor.headHash === report.integrity.headHash &&
    cursor.afterSeq === last.seq &&
    cursor.afterEventHash === last.eventHash &&
    cursor.limit === page.limit &&
    (filterEventTypes === undefined
      ? cursor.eventTypes === undefined
      : cursor.eventTypes !== undefined &&
        cursor.eventTypes.length === filterEventTypes.length &&
        cursor.eventTypes.every((eventType, index) => eventType === filterEventTypes[index]))
  );
}

export function readTracePageReport(value: unknown): TracePageReport {
  return readVersionedReport<TracePageReport>({
    value,
    schemaName: "tracePageReport",
    schemaVersion: tracePageReportSchemaVersion,
    reportName: "trace page report",
    semantics: (report) =>
      areTraceEventsValid(report.events, report.projectId, report.runId) &&
      pageSemanticsAreValid(report),
    error: (failure, message) =>
      new TracePageReportCompatibilityError(
        failure === "unsupported_version"
          ? "trace_page_report_schema_unsupported"
          : "trace_page_report_invalid",
        message,
      ),
  });
}
