import type { DoctorCheck, DoctorIssue } from "@lervo/schemas";

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
  TraceCapabilitiesReport,
  TerminalCoverageReport,
  TerminalTurnCoverage,
  TerminalBudgetPolicy,
  TerminalBudgetReport,
  ManagedContextCoverageReport,
  ManagedContextDocumentCoverage,
  WorkExecutionReport,
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
      | "trace_filter_empty"
      | "trace_result_too_large"
      | "trace_run_not_found"
      | "trace_work_not_found"
      | "terminal_coverage_invalid"
      | "terminal_budget_invalid",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DiagnosticsError";
  }
}
