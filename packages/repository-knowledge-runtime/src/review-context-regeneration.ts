import type {
  KnowledgeConvergenceInput,
  KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import type { KnowledgeConvergenceStage } from "@lervo/schemas";

import { completeConvergenceStage } from "./stage-receipt.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceSourceObservation } from "./source-observation.js";

/** Each obligation regenerates a stale review at most this many times before it needs attention. */
const MAXIMUM_CONTEXT_REGENERATIONS = 3;

/**
 * ADR-0486: a review whose bound context changed before any effect is regenerated from the stage
 * that produced it, instead of settling `review_context_stale` as attention. Integration and apply
 * keep their own fences, because an effect may already have started there.
 */
const REGENERATION: Partial<
  Record<
    KnowledgeConvergenceStage,
    { nextStage: KnowledgeConvergenceStage; clear: Record<string, null> }
  >
> = {
  canonical_review: {
    nextStage: "assessment",
    clear: { canonicalBatch: null, canonicalApproval: null },
  },
  normalization_review: {
    nextStage: "normalization_generation",
    clear: {
      normalizationBatch: null,
      normalizationReview: null,
      normalizationAcceptedCandidateId: null,
    },
  },
};

export function staleReviewContext(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "review_context_stale";
}

export async function regenerateStaleReview(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  stage: KnowledgeConvergenceStage,
): Promise<KnowledgeConvergenceStageResult | null> {
  const plan = REGENERATION[stage];
  const regenerations = Number(state.stageData.reviewContextRegenerations ?? 0);
  if (plan === undefined || regenerations >= MAXIMUM_CONTEXT_REGENERATIONS) return null;
  return completeConvergenceStage({
    sources: convergenceSourceObservation(context),
    artifacts: context.storage.artifacts,
    state,
    stage,
    nextStage: plan.nextStage,
    stageData: { ...plan.clear, reviewContextRegenerations: regenerations + 1 },
    proof: { status: "review_context_regenerated", regeneration: regenerations + 1 },
  });
}
