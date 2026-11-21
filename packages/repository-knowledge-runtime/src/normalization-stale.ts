import type {
  KnowledgeConvergenceInput,
  KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";

import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceSourceObservation } from "./source-observation.js";

/**
 * ADR-0604: stale regeneration did not converge. The same normalization candidate came back stale
 * after its batch was generated again, or the batch went stale more than
 * `MAXIMUM_STALE_REGENERATIONS` times in a row. A cached generation and review make each such loop
 * free, so the stage settles attention instead of looping; it is not retried.
 */
export const NORMALIZATION_CANDIDATE_STALE_REPEATED = "normalization_candidate_stale_repeated";

/** Stale regenerations one batch may take in a row, each under its own bounded call budget. */
export const MAXIMUM_STALE_REGENERATIONS = 2;

/** The stage data that ends a stale chain once the batch settles in any other way. */
export const settledStaleNormalization = {
  normalizationStaleCandidateId: null,
  normalizationStaleRegenerations: 0,
} as const;

/** True when planning or its pre-apply check found the lifecycle moved since the candidate. */
export function normalizationPlanStale(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "knowledge_plan_stale";
}

function staleRegenerations(state: KnowledgeConvergenceInput): number {
  const count = state.stageData.normalizationStaleRegenerations;
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/**
 * ADR-0604: the lifecycle moved since this candidate, for instance after a rewind replayed its
 * generation. The first time, the same batch is generated again against the current lifecycle;
 * naming the stale candidate changes that generation's identity and gives it its own call budget.
 * The same candidate coming back stale, or a chain past the bound, settles visible attention.
 */
export async function staleNormalizationCandidate(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  candidateId: string,
): Promise<KnowledgeConvergenceStageResult> {
  const regenerations = staleRegenerations(state);
  if (
    state.stageData.normalizationStaleCandidateId === candidateId ||
    regenerations >= MAXIMUM_STALE_REGENERATIONS
  )
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      kind: "attention_required",
      reason: NORMALIZATION_CANDIDATE_STALE_REPEATED,
      dependency: {
        kind: "normalization_candidate_stale",
        snapshotHash: state.snapshotHash,
        candidateId,
        previousCandidateId: state.stageData.normalizationStaleCandidateId ?? null,
        regenerations,
      },
    });
  return completeConvergenceStage({
    sources: convergenceSourceObservation(context),
    artifacts: context.storage.artifacts,
    state,
    stage: "normalization_apply",
    nextStage: "normalization_generation",
    stageData: {
      normalizationReview: null,
      normalizationAcceptedCandidateId: null,
      normalizationStaleCandidateId: candidateId,
      normalizationStaleRegenerations: regenerations + 1,
    },
    proof: { status: "candidate_stale", candidateId },
  });
}
