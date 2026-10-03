export function normalizedConvergenceFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "cancelled") return "knowledge_cancelled";
  if (
    code === "knowledge_compile_failed" &&
    ((error as { processStatus?: unknown }).processStatus === "timed_out" ||
      (error as { message?: unknown }).message ===
        "The provider compiler executable version could not be determined.")
  )
    return "knowledge_job_transient_failure";
  const allowed = [
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
    : "knowledge_job_transient_failure";
}
