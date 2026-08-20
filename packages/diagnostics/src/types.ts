import type {
  DoctorCheck,
  DoctorIssue,
  EventEnvelope,
} from "@lervo/schemas";

export type {
  DoctorCheck,
  DoctorIssue,
  DoctorIssueCode,
  DoctorRecoveryActionCode,
  DoctorRecoveryGuidance,
  DoctorReport,
  DoctorScope,
} from "@lervo/schemas";

export type TraceSelector = "last" | string;

export interface TraceReport {
  projectId: string;
  runId: string;
  status: "completed" | "failed" | "incomplete";
  integrity: { valid: true; eventCount: number; headHash: string | null };
  firstOccurredAt: string;
  lastOccurredAt: string;
  sessionIds: string[];
  events: EventEnvelope[];
}

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
