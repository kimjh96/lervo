import { readVersionedReport } from "./report-compatibility.js";
import { isTraceReportSemanticallyValid } from "./trace-report-semantics.js";
import type { TraceReport } from "./types.js";

export const traceReportSchemaVersion = 1 as const;

export type TraceReportCompatibilityErrorCode =
  | "trace_report_invalid"
  | "trace_report_schema_unsupported";

export class TraceReportCompatibilityError extends Error {
  constructor(
    readonly code: TraceReportCompatibilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TraceReportCompatibilityError";
  }
}

export function readTraceReport(value: unknown): TraceReport {
  return readVersionedReport<TraceReport>({
    value,
    schemaName: "traceReport",
    schemaVersion: traceReportSchemaVersion,
    reportName: "trace report",
    semantics: isTraceReportSemanticallyValid,
    error: (failure, message) => new TraceReportCompatibilityError(
      failure === "unsupported_version"
        ? "trace_report_schema_unsupported"
        : "trace_report_invalid",
      message,
    ),
  });
}
