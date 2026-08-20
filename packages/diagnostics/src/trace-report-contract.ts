import { validateSchema } from "@lervo/schemas";

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

function schemaVersionOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return (value as { schemaVersion?: unknown }).schemaVersion;
}

export function readTraceReport(value: unknown): TraceReport {
  const schemaVersion = schemaVersionOf(value);
  if (
    typeof schemaVersion === "number" &&
    Number.isInteger(schemaVersion) &&
    schemaVersion !== traceReportSchemaVersion
  ) {
    throw new TraceReportCompatibilityError(
      "trace_report_schema_unsupported",
      `지원하지 않는 trace report schemaVersion입니다: ${String(schemaVersion)}`,
    );
  }
  const validation = validateSchema("traceReport", value);
  if (!validation.valid) {
    throw new TraceReportCompatibilityError(
      "trace_report_invalid",
      "trace report v1의 필수 구조가 올바르지 않습니다.",
    );
  }
  const report = value as TraceReport;
  if (!isTraceReportSemanticallyValid(report)) {
    throw new TraceReportCompatibilityError(
      "trace_report_invalid",
      "trace report v1의 필수 의미가 서로 일치하지 않습니다.",
    );
  }
  return report;
}
