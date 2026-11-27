import type { KnowledgeConvergenceStage } from "@lervo/schemas";

import type { KnowledgeConvergenceInput } from "./knowledge-convergence-contract.js";

/** Typed transient failures retry with backoff until the logical sixteen-attempt budget. */
export const MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS = 16;
/**
 * A failure without a typed convergence code is not known to be transient. A few backoff attempts
 * absorb a passing host condition before the stage records attention with private evidence.
 */
export const MAXIMUM_UNCLASSIFIED_STAGE_ATTEMPTS = 4;
/**
 * A verification command that could not start or whose program was not found (ADR-0562 section 3)
 * says more about the host than about the sources. It fails in moments, so a few backoff attempts
 * absorb a briefly broken host before the stage records attention.
 */
export const MAXIMUM_VERIFICATION_ENVIRONMENT_ATTEMPTS = 4;
export const VERIFICATION_ENVIRONMENT_FAILED = "knowledge_verification_environment_failed";
/**
 * A verification command that ran out of time may have met a busy host or a hanging check. Each
 * attempt costs the whole timeout and a busy host outlasts a short backoff, so it is not retried
 * at once: it settles and is reevaluated later.
 */
export const VERIFICATION_TIMED_OUT = "knowledge_verification_timed_out";
/** Failure codes whose evidence is a verification suite result that names the failed command. */
export const VERIFICATION_FAILURE_CODES: ReadonlySet<string> = new Set([
  "knowledge_verification_failed",
  VERIFICATION_ENVIRONMENT_FAILED,
  VERIFICATION_TIMED_OUT,
]);

/** Settled failures that may have been the host's own: each holds until its reevaluation time. */
export function reevaluatedConvergenceFailure(code: string): boolean {
  return (
    code === "knowledge_stage_failure_unclassified" ||
    code === VERIFICATION_ENVIRONMENT_FAILED ||
    code === VERIFICATION_TIMED_OUT
  );
}

/**
 * The reviewed name of the evaluation contract (ADR-0479, ADR-0481, ADR-0485). A host adds the
 * identity of its evaluation logic, and a stall settled under any other contract is reevaluated once.
 */
export const KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT = "adr-0532";

/** How long a failure the host may have caused stays settled before the owner reevaluates it. */
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
  if (code === VERIFICATION_ENVIRONMENT_FAILED) return MAXIMUM_VERIFICATION_ENVIRONMENT_ATTEMPTS;
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
    "provider_not_admitted",
    "knowledge_effect_uncertain",
    "normalization_usage_unavailable",
    "normalization_budget_exceeded",
    "knowledge_capacity_unavailable",
    "assignment_path_conflict",
    "assignment_path_outside_responsibility",
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
    VERIFICATION_ENVIRONMENT_FAILED,
    VERIFICATION_TIMED_OUT,
    "knowledge_lifecycle_blocked",
    "knowledge_lifecycle_incomplete",
    "knowledge_lint_invalid",
    "knowledge_compile_failed",
    "knowledge_compile_policy_violation",
    "normalization_selection_invalid",
    // ADR-0604: stale normalization regeneration did not converge; attention, never retried.
    "normalization_candidate_stale_repeated",
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

/**
 * What an unclassified failure was, without its message: the original code and error name when
 * they are identifier-shaped. Private stage evidence keeps it so the next look finds the cause.
 */
export function unclassifiedFailureCause(error: unknown): {
  code: string | null;
  name: string | null;
} {
  const value = error as { code?: unknown; name?: unknown } | null;
  const code =
    typeof value?.code === "string" && /^[A-Za-z][A-Za-z0-9_.-]{1,63}$/u.test(value.code)
      ? value.code
      : null;
  const name =
    typeof value?.name === "string" && /^[A-Za-z][A-Za-z0-9]{1,63}$/u.test(value.name)
      ? value.name
      : null;
  return { code, name };
}

/**
 * The record a settled stage failure stores as its dependency, which the host's
 * `dependencyCurrent` reads to decide whether the stage still waits.
 */
export function convergenceStageFailureRecord(input: {
  code: string;
  error: unknown;
  /** The host's evaluation contract; the stage failure contract when the host names none. */
  evaluationContract: string | undefined;
  state: Pick<KnowledgeConvergenceInput, "snapshotHash" | "obligationId" | "baseline">;
  stage: KnowledgeConvergenceStage;
  now: Date;
}): Record<string, unknown> {
  const { code, error, state } = input;
  const evidence = (error as { dependencyHash?: unknown } | null)?.dependencyHash;
  return {
    schemaVersion: 1,
    kind: "stage_failure",
    code,
    evaluationContract: input.evaluationContract ?? KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT,
    snapshotHash: state.snapshotHash,
    delegationHash: state.baseline.delegationHash,
    evidenceHash: /^sha256:[a-f0-9]{64}$/u.test(String(evidence)) ? (evidence as string) : null,
    // A failure that may have been the host's own holds only until its reevaluation time.
    ...(reevaluatedConvergenceFailure(code)
      ? {
          reevaluateAt: new Date(
            input.now.getTime() + UNCLASSIFIED_STAGE_REEVALUATION_MS,
          ).toISOString(),
        }
      : {}),
    ...(code === "knowledge_stage_failure_unclassified"
      ? { cause: unclassifiedFailureCause(error) }
      : {}),
    // A refused claim waits only while a holder overlaps this stage's own paths.
    ...(code === "assignment_path_conflict"
      ? { obligationId: state.obligationId, stage: input.stage }
      : {}),
  };
}
