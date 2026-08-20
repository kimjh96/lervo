import { validateSchema } from "@lervo/schemas";

import { isDoctorReportSemanticallyValid } from "./doctor-report-semantics.js";
import type { DoctorReport } from "./types.js";

export const doctorReportSchemaVersion = 1 as const;

export type DoctorReportCompatibilityErrorCode =
  | "doctor_report_invalid"
  | "doctor_report_schema_unsupported";

export class DoctorReportCompatibilityError extends Error {
  constructor(
    readonly code: DoctorReportCompatibilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DoctorReportCompatibilityError";
  }
}

function schemaVersionOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { schemaVersion?: unknown }).schemaVersion;
}

export function readDoctorReport(value: unknown): DoctorReport {
  const schemaVersion = schemaVersionOf(value);
  if (
    typeof schemaVersion === "number" &&
    Number.isInteger(schemaVersion) &&
    schemaVersion !== doctorReportSchemaVersion
  ) {
    throw new DoctorReportCompatibilityError(
      "doctor_report_schema_unsupported",
      `지원하지 않는 doctor report schemaVersion입니다: ${String(schemaVersion)}`,
    );
  }

  const validation = validateSchema("doctorReport", value);
  if (!validation.valid) {
    throw new DoctorReportCompatibilityError(
      "doctor_report_invalid",
      "doctor report v1의 필수 구조가 올바르지 않습니다.",
    );
  }
  const report = value as DoctorReport;
  if (!isDoctorReportSemanticallyValid(report)) {
    throw new DoctorReportCompatibilityError(
      "doctor_report_invalid",
      "doctor report v1의 필수 의미가 서로 일치하지 않습니다.",
    );
  }
  return report;
}
