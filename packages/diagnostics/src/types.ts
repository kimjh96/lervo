import type { EventEnvelope } from "@lervo/schemas";

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

export type DoctorIssueCode =
  | "candidate_artifact_invalid"
  | "candidate_decision_missing"
  | "candidate_evidence_missing"
  | "candidate_event_mismatch"
  | "candidate_outcome_not_converged"
  | "candidate_verification_missing"
  | "event_chain_invalid";

export interface DoctorIssue {
  code: DoctorIssueCode;
  eventId: string | null;
  message: string;
}

export interface DoctorCheck {
  checkId: "event_chain" | "knowledge_candidates";
  status: "passed" | "failed";
  observedCount: number;
}

export interface DoctorReport {
  projectId: string;
  status: "healthy" | "issues";
  checks: DoctorCheck[];
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
