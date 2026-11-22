import type {
  KnowledgeInstructionBootstrapPlan,
  KnowledgeInstructionBridgePlan,
  RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";

import {
  GENERATED_EFFECT_CROSS_CHECK,
  type KnowledgeEffectNotice,
} from "./knowledge-effect-commit.js";

type ReviewedLifecyclePlan =
  | Pick<
      RepositoryLayoutMigrationPlan,
      "planKind" | "planId" | "moves" | "userUpdates" | "referenceUpdates"
    >
  | Pick<KnowledgeInstructionBootstrapPlan, "planKind" | "planId">
  | Pick<KnowledgeInstructionBridgePlan, "planId" | "profile">;

/** The cross-check line: the reviewer that agreed, or why an unreviewed plan needs none. */
export function lifecycleCrossCheck(approval: { reviewerAgentId: string } | null): string {
  return approval === null
    ? GENERATED_EFFECT_CROSS_CHECK
    : `lifecycle reviewer ${approval.reviewerAgentId} approved`;
}

/** ADR-0610: the notice of a generated knowledge migration, which commits like any effect. */
export function knowledgeMigrationNotice(planId: string): KnowledgeEffectNotice {
  return {
    effect: "knowledge_migration",
    planId,
    reason: "refreshed the generated repository knowledge outputs",
    crossCheck: GENERATED_EFFECT_CROSS_CHECK,
  };
}

/** Pure: the ADR-0561 notice for one reviewed lifecycle plan and the reviewer that agreed. */
export function lifecycleEffectNotice(
  plan: ReviewedLifecyclePlan,
  crossCheck: string,
): KnowledgeEffectNotice {
  if ("moves" in plan) {
    const updates = plan.userUpdates.length === 0 ? "" : `, updated ${plan.userUpdates.length}`;
    return {
      effect: "repository_layout",
      planId: plan.planId,
      reason: `moved ${plan.moves.length} documents to their classified routes${updates}, rewrote ${plan.referenceUpdates.length} references`,
      crossCheck,
    };
  }
  return "planKind" in plan
    ? {
        effect: "instruction_bootstrap",
        planId: plan.planId,
        reason: "adopted CLAUDE.md as the canonical AGENTS.md instructions",
        crossCheck,
      }
    : {
        effect: "instruction_bridge",
        planId: plan.planId,
        reason: "reconciled the Claude instruction bridge with AGENTS.md",
        crossCheck,
      };
}
