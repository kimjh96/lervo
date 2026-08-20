import type {
  DoctorCheck,
  DoctorIssue,
} from "@lervo/schemas";

export type {
  DoctorCheck,
  DoctorIssue,
  DoctorIssueCode,
  DoctorRecoveryActionCode,
  DoctorRecoveryGuidance,
  DoctorReport,
  DoctorScope,
  TraceReport,
} from "@lervo/schemas";

export type TraceSelector = "last" | string;

export interface DoctorInspection {
  check: DoctorCheck;
  issues: DoctorIssue[];
}

export class DiagnosticsError extends Error {
  constructor(
    readonly code: "trace_empty" | "trace_run_not_found",
    message: string,
  ) {
    super(message);
    this.name = "DiagnosticsError";
  }
}
