import {
  createTraceCapabilitiesReport,
  readTraceCapabilitiesReport,
  TraceCapabilitiesReportCompatibilityError,
} from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

describe("trace capabilities report contract", () => {
  it("reports the current modes, report versions, limits, and deprecation", () => {
    const report = createTraceCapabilitiesReport();

    expect(readTraceCapabilitiesReport(report)).toBe(report);
    expect(report).toEqual({
      schemaVersion: 1,
      capability: "trace",
      defaultMode: "implicit_full",
      modes: [
        {
          mode: "implicit_full",
          explicit: false,
          reportKind: "full",
          reportSchemaVersion: 1,
          eventTypeFilter: false,
          cursorContinuation: false,
        },
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
          explicit: true,
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
      deprecations: [{
        code: "trace_implicit_full_deprecated",
        mode: "implicit_full",
        replacementMode: "full",
        changesIn: "0.1.0",
        nextDefaultMode: "page",
      }],
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
        message: "trace capabilities report v1의 필수 의미가 서로 일치하지 않습니다.",
      }),
    );
    try {
      readTraceCapabilitiesReport(invalid);
    } catch (error) {
      expect(String(error)).not.toContain("private-token");
    }
  });
});
