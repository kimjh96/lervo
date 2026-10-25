import {
  canonicalJson,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";

import { convergenceAssessmentSources } from "./assessment-scope.js";
import type { CanonicalBatch } from "./canonical-review.js";
import {
  boundedReviewReasons,
  mergeParkedSources,
  obligationParkedSources,
  type ParkedConvergenceSource,
  type ParkedTargetObservation,
} from "./convergence-parking.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";

/**
 * ADR-0530: an approved batch whose draft targets diverged on the integration ref integrates
 * nothing, because the reviewer approved its drafts together. The sources that asked for a draft
 * are parked with the exact target bytes they met, every other decision keeps its coverage, and
 * the obligation continues with the next workset and normalization instead of waiting.
 */
export async function parkDivergedCanonicalBatch(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  batch: CanonicalBatch,
  diverged: ParkedTargetObservation[],
): Promise<KnowledgeConvergenceStageResult> {
  const assessmentHash = sha256(canonicalJson(batch.assessment));
  const candidates = new Set(
    batch.assessment.decisions
      .filter((decision) => decision.disposition === "candidate")
      .map((decision) => decision.path),
  );
  // A draft always comes from a candidate; without one, no source can be cleared as covered.
  const parkedPaths = candidates.size > 0 ? candidates : new Set(batch.sources.map((s) => s.path));
  const targets = diverged.slice(0, 8);
  const parked: ParkedConvergenceSource[] = batch.sources
    .filter((source) => parkedPaths.has(source.path))
    .map((source) => ({
      stage: "canonical",
      path: source.path,
      contentHash: source.contentHash,
      reason: "target_diverged",
      attempts: 1,
      reasons: boundedReviewReasons(
        targets.map(
          (target) =>
            `${target.ref} holds ${target.observedHash ?? "no file"} at ${target.path}, not the reviewed preimage`,
        ),
      ),
      targets,
    }));
  const end = batch.offset + batch.count;
  return completeConvergenceStage({
    repositoryRoot: context.storage.paths.repositoryRoot,
    artifacts: context.storage.artifacts,
    state,
    stage: "canonical_integration",
    nextStage:
      end < convergenceAssessmentSources(state).length ? "assessment" : "normalization_generation",
    stageData: {
      canonicalOffset: end,
      canonicalBatch: null,
      canonicalApproval: null,
      canonicalCoverage: [
        ...((state.stageData.canonicalCoverage as unknown[] | undefined) ?? []),
        ...batch.assessment.decisions
          .filter((decision) => !parkedPaths.has(decision.path))
          .map((decision) => ({
            path: decision.path,
            contentHash: decision.contentHash,
            disposition: decision.disposition,
            assessmentHash,
          })),
      ],
      parkedSources: mergeParkedSources(obligationParkedSources(state), parked),
      // The disposition ledger reads this marker: nothing in this batch was integrated.
      canonicalTargetParked: assessmentHash,
    },
    proof: {
      status: "target_diverged_parked",
      assessmentHash,
      sources: parked.map(({ path, contentHash }) => ({ path, contentHash })),
      targets,
    },
  });
}
