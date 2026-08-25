import { DoctorReportCompatibilityError, readDoctorReport } from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

const report = {
  schemaVersion: 1,
  projectId: "prj_01234567",
  scope: "search",
  status: "unknown",
  checks: [
    {
      checkId: "search_engine_selection",
      status: "healthy",
      observedCount: 1,
    },
    {
      checkId: "search_rollout_policies",
      status: "healthy",
      observedCount: 3,
    },
    {
      checkId: "search_rollout_reviews",
      status: "unknown",
      observedCount: 0,
    },
    {
      checkId: "search_rollout_actions",
      status: "unknown",
      observedCount: 0,
    },
  ],
  issues: [
    {
      code: "search_rollout_review_unavailable",
      eventId: null,
      message: "The prerequisite search check could not be completed.",
    },
  ],
  recoveryGuidance: [
    {
      issueCode: "search_rollout_review_unavailable",
      actionCode: "resolve_search_review_prerequisites",
      message:
        "Resolve the search engine selection and policy issues first, then diagnose the rollout review again.",
      actionState: "not_performed",
    },
  ],
} as const;

describe("doctor report compatibility contract", () => {
  it("reads a valid v1 report", () => {
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

  it("distinguishes an unsupported integer schema version", () => {
    expect(() => readDoctorReport({ ...report, schemaVersion: 2 })).toThrowError(
      expect.objectContaining<Partial<DoctorReportCompatibilityError>>({
        code: "doctor_report_schema_unsupported",
      }),
    );
  });

  it.each([
    ["missing schemaVersion", (({ schemaVersion: _, ...value }) => value)(report)],
    ["non-integer schemaVersion", { ...report, schemaVersion: "1" }],
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
        checks: report.checks.slice(0, 3),
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
  ])("rejects invalid v1 input: %s", (_name, value) => {
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
    ).toThrowError("The required structure of doctor report v1 is invalid.");
  });
});
