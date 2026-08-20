import type { TraceCapabilitiesReport } from "./types.js";
import { maximumTraceCursorBytes } from "./trace-cursor.js";
import { defaultTracePageSize, maximumTracePageSize } from "./trace-page.js";
import { tracePageReportSchemaVersion } from "./trace-page-report-contract.js";
import { maximumTraceReportEvents } from "./trace.js";
import { traceReportSchemaVersion } from "./trace-report-contract.js";
import { readVersionedReport } from "./report-compatibility.js";

export const traceCapabilitiesReportSchemaVersion = 1 as const;
export const traceImplicitFullDeprecationCode = "trace_implicit_full_deprecated" as const;

export type TraceCapabilitiesReportCompatibilityErrorCode =
  | "trace_capabilities_report_invalid"
  | "trace_capabilities_report_schema_unsupported";

export class TraceCapabilitiesReportCompatibilityError extends Error {
  constructor(
    readonly code: TraceCapabilitiesReportCompatibilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TraceCapabilitiesReportCompatibilityError";
  }
}

function semanticsAreValid(report: TraceCapabilitiesReport): boolean {
  const modes = new Map(report.modes.map((mode) => [mode.mode, mode]));
  const defaultMode = modes.get(report.defaultMode);
  const deprecationCodes = new Set(report.deprecations.map(({ code }) => code));
  return modes.size === report.modes.length &&
    defaultMode !== undefined &&
    report.limits.defaultPageSize <= report.limits.maximumPageSize &&
    deprecationCodes.size === report.deprecations.length &&
    report.deprecations.every((deprecation) =>
      modes.has(deprecation.mode) &&
      modes.has(deprecation.replacementMode) &&
      modes.has(deprecation.nextDefaultMode) &&
      deprecation.mode !== deprecation.replacementMode
    );
}

export function readTraceCapabilitiesReport(value: unknown): TraceCapabilitiesReport {
  return readVersionedReport<TraceCapabilitiesReport>({
    value,
    schemaName: "traceCapabilitiesReport",
    schemaVersion: traceCapabilitiesReportSchemaVersion,
    reportName: "trace capabilities report",
    semantics: semanticsAreValid,
    error: (failure, message) => new TraceCapabilitiesReportCompatibilityError(
      failure === "unsupported_version"
        ? "trace_capabilities_report_schema_unsupported"
        : "trace_capabilities_report_invalid",
      message,
    ),
  });
}

export function createTraceCapabilitiesReport(): TraceCapabilitiesReport {
  return readTraceCapabilitiesReport({
    schemaVersion: traceCapabilitiesReportSchemaVersion,
    capability: "trace",
    defaultMode: "implicit_full",
    modes: [
      {
        mode: "implicit_full",
        explicit: false,
        reportKind: "full",
        reportSchemaVersion: traceReportSchemaVersion,
        eventTypeFilter: false,
        cursorContinuation: false,
      },
      {
        mode: "full",
        explicit: true,
        reportKind: "full",
        reportSchemaVersion: traceReportSchemaVersion,
        eventTypeFilter: false,
        cursorContinuation: false,
      },
      {
        mode: "page",
        explicit: true,
        reportKind: "page",
        reportSchemaVersion: tracePageReportSchemaVersion,
        eventTypeFilter: true,
        cursorContinuation: true,
      },
      {
        mode: "cursor",
        explicit: true,
        reportKind: "page",
        reportSchemaVersion: tracePageReportSchemaVersion,
        eventTypeFilter: false,
        cursorContinuation: true,
      },
    ],
    limits: {
      defaultPageSize: defaultTracePageSize,
      maximumPageSize: maximumTracePageSize,
      maximumFullEventCount: maximumTraceReportEvents,
      maximumCursorBytes: maximumTraceCursorBytes,
    },
    deprecations: [
      {
        code: traceImplicitFullDeprecationCode,
        mode: "implicit_full",
        replacementMode: "full",
        changesIn: "0.1.0",
        nextDefaultMode: "page",
      },
    ],
  });
}
