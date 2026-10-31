import {
  createTraceCapabilitiesReport,
  readTraceCapabilitiesReport,
  TraceCapabilitiesReportCompatibilityError,
} from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

describe("trace capabilities report contract", () => {
  it("reports the bounded default, supported modes, report versions, and limits", () => {
    const report = createTraceCapabilitiesReport();

    expect(readTraceCapabilitiesReport(report)).toBe(report);
    expect(report).toEqual({
      schemaVersion: 1,
      capability: "trace",
      eventReader: {
        schemaVersion: 1,
        capability: "event_reader",
        readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
      },
      defaultMode: "page",
      modes: [
        {
          mode: "full",
          explicit: true,
          reportKind: "full",
          reportSchemaVersion: 1,
          eventTypeFilter: false,
          cursorContinuation: false,
        },
        {
          mode: "page",
          explicit: false,
          reportKind: "page",
          reportSchemaVersion: 1,
          eventTypeFilter: true,
          cursorContinuation: true,
        },
        {
          mode: "cursor",
          explicit: true,
          reportKind: "page",
          reportSchemaVersion: 1,
          eventTypeFilter: false,
          cursorContinuation: true,
        },
      ],
      limits: {
        defaultPageSize: 50,
        maximumPageSize: 100,
        maximumFullEventCount: 1000,
        maximumCursorBytes: 2048,
      },
      deprecations: [],
    });
  });

  it("accepts additive fields and rejects unsupported versions", () => {
    const report = createTraceCapabilitiesReport();
    const extended = { ...report, generatedBy: "future-lervo" };
    expect(readTraceCapabilitiesReport(extended)).toBe(extended);
    expect(() => readTraceCapabilitiesReport({ ...report, schemaVersion: 2 })).toThrowError(
      expect.objectContaining<Partial<TraceCapabilitiesReportCompatibilityError>>({
        code: "trace_capabilities_report_schema_unsupported",
      }),
    );
  });

  it("continues to read historical reports without event-reader advertisement", () => {
    const { eventReader: _eventReader, ...historical } = createTraceCapabilitiesReport();

    expect(readTraceCapabilitiesReport(historical)).toBe(historical);
  });

  it("rejects contradictory mode references without exposing input contents", () => {
    const report = createTraceCapabilitiesReport();
    const invalid = {
      ...report,
      privateValue: "private-token",
      defaultMode: "cursor" as const,
      modes: report.modes.filter(({ mode }) => mode !== "cursor"),
    };

    expect(() => readTraceCapabilitiesReport(invalid)).toThrowError(
      expect.objectContaining<Partial<TraceCapabilitiesReportCompatibilityError>>({
        code: "trace_capabilities_report_invalid",
        message: "The required semantics of trace capabilities report v1 are inconsistent.",
      }),
    );
    try {
      readTraceCapabilitiesReport(invalid);
    } catch (error) {
      expect(String(error)).not.toContain("private-token");
    }
  });

  it("requires exactly one non-explicit mode and makes it the default", () => {
    const report = createTraceCapabilitiesReport();
    expect(() =>
      readTraceCapabilitiesReport({
        ...report,
        modes: report.modes.map((mode) => ({ ...mode, explicit: true })),
      }),
    ).toThrowError(expect.objectContaining({ code: "trace_capabilities_report_invalid" }));
  });

  it("continues to read the historical 0.0.x implicit-full capability report", () => {
    const current = createTraceCapabilitiesReport();
    const historical = {
      ...current,
      defaultMode: "implicit_full" as const,
      modes: [
        {
          mode: "implicit_full" as const,
          explicit: false,
          reportKind: "full" as const,
          reportSchemaVersion: 1,
          eventTypeFilter: false,
          cursorContinuation: false,
        },
        ...current.modes.map((mode) => (mode.mode === "page" ? { ...mode, explicit: true } : mode)),
      ],
      deprecations: [
        {
          code: "trace_implicit_full_deprecated",
          mode: "implicit_full" as const,
          replacementMode: "full" as const,
          changesIn: "0.1.0",
          nextDefaultMode: "page" as const,
        },
      ],
    };

    expect(readTraceCapabilitiesReport(historical)).toBe(historical);
  });
});
