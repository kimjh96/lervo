import {
  boundedReviewReasons,
  mergeParkedSources,
  type ParkedConvergenceSource,
} from "./convergence-parking.js";

/** The reviewed lifecycle plans a stage can park, by the currency reason each leaves pending. */
const LIFECYCLE_PLAN_REASONS = {
  repository_layout: "layout_migration_pending",
  instruction_bootstrap: "instruction_bootstrap_pending",
  instruction_bridge: "instruction_bridge_pending",
} as const;

export type LifecyclePlanKind = keyof typeof LIFECYCLE_PLAN_REASONS;

/** The plan hash and reason a rejected exact lifecycle plan review carries. */
export function lifecyclePlanRejection(
  error: unknown,
): { planHash: string; rationale: string } | null {
  const rejection = (error as { lifecyclePlanRejection?: unknown } | null)
    ?.lifecyclePlanRejection as { planHash?: unknown; rationale?: unknown } | undefined;
  return (error as { code?: unknown } | null)?.code === "knowledge_semantic_review_rejected" &&
    typeof rejection?.planHash === "string" &&
    typeof rejection.rationale === "string"
    ? { planHash: rejection.planHash, rationale: rejection.rationale }
    : null;
}

/** Whether this exact plan was already parked; a changed plan is reviewed again. */
export function lifecyclePlanParked(
  parked: readonly ParkedConvergenceSource[],
  kind: LifecyclePlanKind,
  planHash: string,
): boolean {
  return parked.some(
    (item) => item.stage === "lifecycle" && item.path === kind && item.contentHash === planHash,
  );
}

/**
 * ADR-0485: a deterministic plan regenerates identically, so a rejected plan is parked at once with
 * the reviewer's reason. Any earlier parking of the same kind is replaced.
 */
export function parkLifecyclePlan(
  parked: readonly ParkedConvergenceSource[],
  kind: LifecyclePlanKind,
  rejection: { planHash: string; rationale: string },
  reason: "review_rejected" | "user_owned_content" = "review_rejected",
): ParkedConvergenceSource[] {
  return mergeParkedSources(parked, [
    {
      stage: "lifecycle",
      path: kind,
      contentHash: rejection.planHash,
      reason,
      attempts: 1,
      reasons: boundedReviewReasons([rejection.rationale]),
    },
  ]);
}

/** Currency reasons that only parked lifecycle plans leave pending. */
export function parkedLifecycleCurrencyReasons(
  parked: readonly ParkedConvergenceSource[],
): Set<string> {
  return new Set(
    parked
      .filter((item) => item.stage === "lifecycle" && item.path in LIFECYCLE_PLAN_REASONS)
      .map((item) => LIFECYCLE_PLAN_REASONS[item.path as LifecyclePlanKind]),
  );
}
