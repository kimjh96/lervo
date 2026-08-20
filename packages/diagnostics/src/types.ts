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
  TracePageReport,
  TraceReport,
} from "@lervo/schemas";

export type TraceSelector = "last" | string;

export interface DoctorInspection {
  check: DoctorCheck;
  issues: DoctorIssue[];
}

export class DiagnosticsError extends Error {
  constructor(
    readonly code:
      | "trace_cursor_invalid"
      | "trace_cursor_stale"
      | "trace_empty"
      | "trace_result_too_large"
      | "trace_run_not_found",
    message: string,
  ) {
    super(message);
    this.name = "DiagnosticsError";
  }
}
