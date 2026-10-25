/** Typed transient failures retry with backoff until the logical sixteen-attempt budget. */
export const MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS = 16;
/**
 * A failure without a typed convergence code is not known to be transient. A few backoff attempts
 * absorb a passing host condition before the stage records attention with private evidence.
 */
export const MAXIMUM_UNCLASSIFIED_STAGE_ATTEMPTS = 4;

/**
 * The reviewed name of the evaluation contract (ADR-0479, ADR-0481, ADR-0485). A host adds the
 * identity of its evaluation logic, and a stall settled under any other contract is reevaluated once.
 */
export const KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT = "adr-0532";

/** How long an unclassified attention stays settled before the owner reevaluates the stage. */
export const UNCLASSIFIED_STAGE_REEVALUATION_MS = 6 * 60 * 60_000;

/** Failure codes the owner reschedules instead of settling, with their logical attempt budgets. */
export function convergenceRetryLimit(code: string): number | null {
  if (
    code === "knowledge_job_transient_failure" ||
    code === "knowledge_materialization_busy" ||
    code === "knowledge_project_unavailable"
  )
    return MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS;
  if (code === "knowledge_stage_failure_unclassified") return MAXIMUM_UNCLASSIFIED_STAGE_ATTEMPTS;
  return null;
}

export function normalizedConvergenceFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "cancelled") return "knowledge_cancelled";
  // ADR-0485: `lervo upgrade` briefly rewrites the project manifest under a running resident.
  if (code === "not_initialized") return "knowledge_project_unavailable";
  if (
    code === "knowledge_compile_failed" &&
    ((error as { processStatus?: unknown }).processStatus === "timed_out" ||
      (error as { message?: unknown }).message ===
        "The provider compiler executable version could not be determined.")
  )
    return "knowledge_job_transient_failure";
  const allowed = [
    "knowledge_job_transient_failure",
    "knowledge_integration_target_unavailable",
    "source_bytes_changed",
    "review_context_stale",
    "review_context_limit_exceeded",
    "review_context_unavailable",
    "knowledge_authority_unavailable",
    "knowledge_provider_paused",
    "knowledge_effect_uncertain",
    "normalization_usage_unavailable",
    "normalization_budget_exceeded",
    "knowledge_capacity_unavailable",
    "assignment_path_conflict",
    "knowledge_semantic_review_invalid",
    "knowledge_usage_unavailable",
    "knowledge_job_source_invalid",
    "knowledge_job_source_unavailable",
    "knowledge_source_limit_exceeded",
    "knowledge_source_kind_unsupported",
    "knowledge_retry_exhausted",
    "knowledge_semantic_review_rejected",
    "knowledge_sources_parked",
    "knowledge_verification_modified_sources",
    "knowledge_project_unavailable",
    "knowledge_cancelled",
    "knowledge_verification_failed",
    "knowledge_lifecycle_blocked",
    "knowledge_lifecycle_incomplete",
    "knowledge_lint_invalid",
    "knowledge_compile_failed",
    "knowledge_compile_policy_violation",
    "normalization_selection_invalid",
    "knowledge_source_unsafe",
    "knowledge_unit_extraction_failed",
    "knowledge_rollback_failed",
    "knowledge_apply_failed",
    "knowledge_finalization_failed",
    "document_layout_permit_required",
    "document_layout_permit_invalid",
    "document_rewrite_ownership_conflict",
    "document_role_conflict",
    "document_role_policy_unresolved",
    "document_repository_capacity_exceeded",
    "document_directory_file_capacity_exceeded",
    "document_directory_child_capacity_exceeded",
    "asset_verification_required",
    "knowledge_plan_stale",
    "knowledge_reconciliation_conflict",
    "knowledge_approval_required",
    "host_effect_uncertain",
    "host_coordinate_invalid",
    "knowledge_recovery_required",
    "knowledge_recovery_busy",
    "knowledge_recovery_invalid",
    "knowledge_materialization_busy",
    "knowledge_source_gate_invalid",
  ];
  return typeof code === "string" && allowed.includes(code)
    ? code
    : "knowledge_stage_failure_unclassified";
}
