import { isDoctorReportSemanticallyValid } from "./doctor-report-semantics.js";
import { readVersionedReport } from "./report-compatibility.js";
import type { DoctorReport } from "./types.js";

export const doctorReportSchemaVersion = 2 as const;

export type DoctorReportCompatibilityErrorCode =
  "doctor_report_invalid" | "doctor_report_schema_unsupported";

export class DoctorReportCompatibilityError extends Error {
  constructor(
    readonly code: DoctorReportCompatibilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DoctorReportCompatibilityError";
  }
}

export function readDoctorReport(value: unknown): DoctorReport {
  return readVersionedReport<DoctorReport>({
    value,
    schemaName: "doctorReport",
    schemaVersion: doctorReportSchemaVersion,
    reportName: "doctor report",
    semantics: isDoctorReportSemanticallyValid,
    error: (failure, message) =>
      new DoctorReportCompatibilityError(
        failure === "unsupported_version"
          ? "doctor_report_schema_unsupported"
          : "doctor_report_invalid",
        message,
      ),
  });
}
