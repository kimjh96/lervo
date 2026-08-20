import { validateSchema } from "@lervo/schemas";

import { decodeTraceCursor } from "./trace-cursor.js";
import { areTraceEventsValid } from "./trace-report-semantics.js";
import type { TracePageReport } from "./types.js";

export const tracePageReportSchemaVersion = 1 as const;

export type TracePageReportCompatibilityErrorCode =
  | "trace_page_report_invalid"
  | "trace_page_report_schema_unsupported";

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
    (report.integrity.eventCount === last.seq &&
      report.integrity.headHash !== last.eventHash) ||
    first.seq <= page.afterSeq ||
    (first.seq === page.afterSeq + 1 &&
      page.afterEventHash !== null && first.previousHash !== page.afterEventHash) ||
    page.hasMore !== (page.nextCursor !== null)
  ) {
    return false;
  }
  if (page.nextCursor === null) return true;
  const cursor = decodeTraceCursor(page.nextCursor);
  return cursor !== null &&
    cursor.projectId === report.projectId &&
    cursor.runId === report.runId &&
    cursor.eventCount === report.integrity.eventCount &&
    cursor.headHash === report.integrity.headHash &&
    cursor.afterSeq === last.seq &&
    cursor.afterEventHash === last.eventHash &&
    cursor.limit === page.limit;
}

export function readTracePageReport(value: unknown): TracePageReport {
  const schemaVersion = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  if (
    typeof schemaVersion === "number" &&
    Number.isInteger(schemaVersion) &&
    schemaVersion !== tracePageReportSchemaVersion
  ) {
    throw new TracePageReportCompatibilityError(
      "trace_page_report_schema_unsupported",
      `지원하지 않는 trace page report schemaVersion입니다: ${String(schemaVersion)}`,
    );
  }
  const validation = validateSchema("tracePageReport", value);
  if (!validation.valid) {
    throw new TracePageReportCompatibilityError(
      "trace_page_report_invalid",
      "trace page report v1의 필수 구조가 올바르지 않습니다.",
    );
  }
  const report = value as TracePageReport;
  if (
    !areTraceEventsValid(report.events, report.projectId, report.runId) ||
    !pageSemanticsAreValid(report)
  ) {
    throw new TracePageReportCompatibilityError(
      "trace_page_report_invalid",
      "trace page report v1의 필수 의미가 서로 일치하지 않습니다.",
    );
  }
  return report;
}
