import type { EventEnvelope } from "@lervo/schemas";

export type TraceSelector = "last" | string;

export type DoctorScope = "all" | "search";

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
  | "review_artifact_invalid"
  | "review_candidate_missing"
  | "review_event_mismatch"
  | "verified_artifact_invalid"
  | "verified_candidate_missing"
  | "verified_event_mismatch"
  | "verified_review_missing"
  | "staleness_artifact_invalid"
  | "staleness_event_mismatch"
  | "staleness_verified_missing"
  | "event_chain_invalid"
  | "document_registry_invalid"
  | "document_source_invalid"
  | "skill_package_invalid"
  | "skill_lock_missing"
  | "skill_lock_invalid"
  | "skill_lock_stale"
  | "provider_executable_missing"
  | "provider_probe_failed"
  | "provider_platform_unsupported"
  | "search_engine_selection_invalid"
  | "search_rollout_policy_invalid"
  | "search_rollout_review_invalid"
  | "search_rollout_review_unavailable"
  | "search_rollout_action_invalid"
  | "search_rollout_action_unavailable";

export interface DoctorIssue {
  code: DoctorIssueCode;
  eventId: string | null;
  message: string;
}

export interface DoctorCheck {
  checkId:
    | "event_chain"
    | "knowledge_candidates"
    | "knowledge_reviews"
    | "verified_knowledge"
    | "knowledge_staleness"
    | "document_registry"
    | "document_sources"
    | "skill_packages"
    | "skill_lock"
    | "provider_codex_runtime"
    | "provider_claude_runtime"
    | "search_engine_selection"
    | "search_rollout_policies"
    | "search_rollout_reviews"
    | "search_rollout_actions";
  status: "healthy" | "unhealthy" | "unknown";
  observedCount: number;
  version?: string;
}

export interface DoctorInspection {
  check: DoctorCheck;
  issues: DoctorIssue[];
}

export interface DoctorReport {
  projectId: string;
  scope: DoctorScope;
  status: "healthy" | "unhealthy" | "unknown";
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
