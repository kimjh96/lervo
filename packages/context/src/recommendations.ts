import {
  assertSearchRecommendationBatch,
  type SearchRecommendation,
  type SearchRecommendationBatch,
} from "@lervo/search";

import { ContextSelectionAccumulator } from "./accumulator.js";
import { ContextEvidenceCollector } from "./evidence.js";
import {
  type ContextDocumentCandidate,
  ContextPreparationError,
  type ContextRunCoordinates,
} from "./types.js";

const MAX_BATCHES = 8;
const MAX_TOTAL_RECOMMENDATIONS = 50;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface AppliedSearchRecommendation {
  recommendation: SearchRecommendation;
  selectionPolicy: SearchRecommendationBatch["selectionPolicy"];
  candidate: ContextDocumentCandidate;
}

function invalid(message: string, cause?: unknown): never {
  throw new ContextPreparationError(
    "invalid_search_recommendation",
    message,
    cause === undefined ? undefined : { cause },
  );
}

export function applySearchRecommendationBatches(input: {
  batches: readonly SearchRecommendationBatch[];
  coordinates: ContextRunCoordinates;
  recordedAt: Date;
  candidates: ReadonlyMap<string, ContextDocumentCandidate>;
  accumulator: ContextSelectionAccumulator;
}): AppliedSearchRecommendation[] {
  if (input.batches.length > MAX_BATCHES) invalid("The number of search recommendation batches exceeds the allowed limit.");
  const batchIds = new Set<string>();
  const recommendationIds = new Set<string>();
  const applied: AppliedSearchRecommendation[] = [];
  for (const batch of [...input.batches].sort((left, right) => compareText(left.batchId, right.batchId))) {
    try {
      assertSearchRecommendationBatch(batch);
    } catch (error) {
      invalid("The search recommendation batch does not match the source search attempt.", error);
    }
    if (batchIds.has(batch.batchId) || batch.attempt.projectId !== input.coordinates.projectId ||
      Date.parse(batch.attempt.observedAt) > input.recordedAt.getTime()) {
      invalid("The search recommendation batch ID, project, or time coordinates differ from the current context.");
    }
    batchIds.add(batch.batchId);
    const selected = new Set(batch.selectedRecommendationIds);
    for (const recommendation of batch.recommendations) {
      if (recommendationIds.has(recommendation.recommendationId)) {
        invalid("The same search recommendation is duplicated in the context input.");
      }
      recommendationIds.add(recommendation.recommendationId);
      if (recommendationIds.size > MAX_TOTAL_RECOMMENDATIONS) {
        invalid("The number of search recommendations exceeds the context input limit.");
      }
      const candidate = input.candidates.get(recommendation.documentId);
      if (candidate === undefined) {
        invalid(`The search-recommended document is not in the registry: ${recommendation.documentId}`);
      }
      input.accumulator.discover(candidate);
      if (selected.has(recommendation.recommendationId)) {
        input.accumulator.select({
          candidate,
          reason: {
            reasonCode: "search_recommendation",
            ruleId: `search_recommendation:${recommendation.recommendationId}`,
          },
          expectedContentHash: recommendation.sourceContentHash,
        });
      }
      applied.push({ recommendation, selectionPolicy: batch.selectionPolicy, candidate });
    }
  }
  return applied;
}

export function recordSearchRecommendationEvidence(input: {
  applied: readonly AppliedSearchRecommendation[];
  coordinates: ContextRunCoordinates;
  recordedAt: string;
  createReceiptId: () => string;
  evidence: ContextEvidenceCollector;
}): void {
  for (const { recommendation, selectionPolicy, candidate } of input.applied) {
    input.evidence.add({
      receiptId: input.createReceiptId(),
      projectId: input.coordinates.projectId,
      runId: input.coordinates.runId,
      sessionId: input.coordinates.sessionId,
      documentId: recommendation.documentId,
      state: "recommended",
      recordedAt: input.recordedAt,
      recommendationId: recommendation.recommendationId,
      batchId: recommendation.batchId,
      sourceAttemptId: recommendation.sourceAttemptId,
      engineId: recommendation.engine.id,
      engineVersion: recommendation.engine.version,
      selectionTransitionId: recommendation.selectionTransitionId,
      indexId: recommendation.indexId,
      resultSetHash: recommendation.resultSetHash,
      sourceContentHash: recommendation.sourceContentHash,
      rank: recommendation.rank,
      score: recommendation.score,
      selectionPolicyId: selectionPolicy.id,
      selectionPolicyVersion: selectionPolicy.version,
      selectionMaximum: selectionPolicy.maximumSelections,
      ...(candidate.knowledgeContext === undefined
        ? {}
        : { knowledgeContext: structuredClone(candidate.knowledgeContext) }),
    });
  }
}
