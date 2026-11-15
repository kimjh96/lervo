import {
  canonicalJson,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";

import { convergenceAssessmentSources } from "./assessment-scope.js";
import type { CanonicalAssessmentSource } from "./canonical-assessment-contract.js";
import type { CanonicalBatch } from "./canonical-review.js";
import {
  boundedReviewReasons,
  mergeParkedSources,
  obligationParkedSources,
  parkedPaths,
  type ParkedConvergenceSource,
} from "./convergence-parking.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceSourceObservation } from "./source-observation.js";

/** While the cursor is inside a rejected span, worksets hold at most `limit` sources. */
interface CanonicalIsolation {
  offset: number;
  end: number;
  limit: number;
}

export interface CanonicalRejection {
  rationale: string;
}

function isolation(state: KnowledgeConvergenceInput): CanonicalIsolation | null {
  const value = state.stageData.canonicalIsolation as Partial<CanonicalIsolation> | null;
  return value &&
    Number.isSafeInteger(value.offset) &&
    Number.isSafeInteger(value.end) &&
    Number.isSafeInteger(value.limit) &&
    value.limit! >= 1
    ? (value as CanonicalIsolation)
    : null;
}

/**
 * ADR-0479: the next canonical workset skips parked sources whose bytes are unchanged, stops before
 * the next parked one, and stays within an active isolation span's halved limit.
 */
export function canonicalWorksetWindow(
  sources: readonly CanonicalAssessmentSource[],
  offset: number,
  parked: readonly ParkedConvergenceSource[],
  state: KnowledgeConvergenceInput,
): { offset: number; maximumDocuments: number } {
  const hashes = new Map(sources.map((source) => [source.path, source.contentHash]));
  const skipped = parkedPaths(parked, "canonical", (path) => hashes.get(path));
  let start = offset;
  while (start < sources.length && skipped.has(sources[start]!.path)) start++;
  let next = start;
  while (next < sources.length && !skipped.has(sources[next]!.path)) next++;
  const span = isolation(state);
  const limit = span !== null && start >= span.offset && start < span.end ? span.limit : Infinity;
  return { offset: start, maximumDocuments: Math.min(next - start, limit) };
}

/**
 * After the bounded feedback retry, a rejected multi-source batch is halved at the same offset so
 * the reviewer judges smaller worksets. A rejected single source is parked, and assessment moves
 * past it. A single source its generator marked `needs_review` is an owner decision.
 */
export async function isolateRejectedCanonicalBatch(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  batch: CanonicalBatch;
  rejection: CanonicalRejection;
  attempts: number;
}): Promise<KnowledgeConvergenceStageResult> {
  const { batch, state } = input;
  const assessmentHash = sha256(canonicalJson(batch.assessment));
  const common = {
    sources: convergenceSourceObservation(input.context),
    artifacts: input.context.storage.artifacts,
    state,
    stage: "canonical_review" as const,
  };
  if (batch.sources.length > 1) {
    const limit = Math.max(1, Math.floor(batch.sources.length / 2));
    return completeConvergenceStage({
      ...common,
      nextStage: "assessment",
      stageData: {
        canonicalBatch: null,
        canonicalApproval: null,
        canonicalReviewRetry: null,
        canonicalIsolation: { offset: batch.offset, end: batch.offset + batch.count, limit },
      },
      proof: { status: "review_rejected_isolating", assessmentHash, limit },
    });
  }
  const source = batch.sources[0]!;
  const decision = batch.assessment.decisions.find((item) => item.path === source.path);
  const parked: ParkedConvergenceSource = {
    stage: "canonical",
    path: source.path,
    contentHash: source.contentHash,
    reason: decision?.disposition === "needs_review" ? "owner_decision" : "review_rejected",
    attempts: input.attempts,
    reasons: boundedReviewReasons([
      ...(decision?.disposition === "needs_review" ? [decision.rationale] : []),
      input.rejection.rationale,
    ]),
  };
  const end = batch.offset + batch.count;
  return completeConvergenceStage({
    ...common,
    nextStage:
      end < convergenceAssessmentSources(state).length ? "assessment" : "normalization_generation",
    stageData: {
      canonicalOffset: end,
      canonicalBatch: null,
      canonicalApproval: null,
      canonicalReviewRetry: null,
      parkedSources: mergeParkedSources(obligationParkedSources(state), [parked]),
    },
    proof: {
      status: "source_parked",
      assessmentHash,
      source: { path: source.path, contentHash: source.contentHash },
      reason: parked.reason,
    },
  });
}
