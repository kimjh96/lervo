import { DoctorReportCompatibilityError, readDoctorReport } from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

const report = {
  schemaVersion: 2,
  projectId: "prj_01234567",
  scope: "search",
  status: "unhealthy",
  checks: [
    {
      checkId: "search_engine_selection",
      status: "unhealthy",
      observedCount: 0,
    },
  ],
  issues: [
    {
      code: "search_engine_selection_invalid",
      eventId: null,
      message: "Could not safely resolve the current search engine.",
    },
  ],
  recoveryGuidance: [
    {
      issueCode: "search_engine_selection_invalid",
      actionCode: "inspect_search_selection",
      message:
        "Check that the product-default search engine is registered with its qualified build, then rerun search-scope diagnostics.",
      actionState: "not_performed",
    },
  ],
} as const;

describe("doctor report compatibility contract", () => {
  it("reads a valid v2 report", () => {
    expect(readDoctorReport(structuredClone(report))).toEqual(report);
  });

  it("accepts additive fields at report and item boundaries", () => {
    const extended = {
      ...structuredClone(report),
      generatedBy: "future-lervo",
      checks: report.checks.map((check, index) => ({
        ...check,
        ...(index === 0 ? { durationMs: 12 } : {}),
      })),
      issues: [{ ...report.issues[0], documentationUrl: "https://example.invalid" }],
      recoveryGuidance: [{ ...report.recoveryGuidance[0], automationHint: "future" }],
    };

    expect(readDoctorReport(extended)).toBe(extended);
  });

  it.each([1, 3])("distinguishes unsupported integer schema version %i", (schemaVersion) => {
    expect(() => readDoctorReport({ ...report, schemaVersion })).toThrowError(
      expect.objectContaining<Partial<DoctorReportCompatibilityError>>({
        code: "doctor_report_schema_unsupported",
      }),
    );
  });

  it.each([
    ["missing schemaVersion", (({ schemaVersion: _, ...value }) => value)(report)],
    ["non-integer schemaVersion", { ...report, schemaVersion: "2" }],
    [
      "unknown controlled value",
      {
        ...report,
        checks: [{ ...report.checks[0], checkId: "future_search_check" }],
      },
    ],
    [
      "missing required collection",
      {
        ...report,
        recoveryGuidance: undefined,
      },
    ],
    [
      "scope and checks disagree",
      {
        ...report,
        checks: [],
      },
    ],
    [
      "aggregate status disagrees",
      {
        ...report,
        status: "healthy",
      },
    ],
    [
      "recovery guidance is not derived from issues",
      {
        ...report,
        recoveryGuidance: [],
      },
    ],
  ])("rejects invalid v2 input: %s", (_name, value) => {
    expect(() => readDoctorReport(value)).toThrowError(
      expect.objectContaining<Partial<DoctorReportCompatibilityError>>({
        code: "doctor_report_invalid",
      }),
    );
  });

  it("does not include report contents in validation errors", () => {
    expect(() =>
      readDoctorReport({
        ...report,
        schemaVersion: "private-token",
      }),
    ).toThrowError("The required structure of doctor report v2 is invalid.");
  });
});
