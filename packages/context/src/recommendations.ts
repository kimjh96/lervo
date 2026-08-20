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
  if (input.batches.length > MAX_BATCHES) invalid("검색 추천 묶음 수가 허용 한도를 넘었습니다.");
  const batchIds = new Set<string>();
  const recommendationIds = new Set<string>();
  const applied: AppliedSearchRecommendation[] = [];
  for (const batch of [...input.batches].sort((left, right) => compareText(left.batchId, right.batchId))) {
    try {
      assertSearchRecommendationBatch(batch);
    } catch (error) {
      invalid("검색 추천 묶음이 원본 검색 시도와 일치하지 않습니다.", error);
    }
    if (batchIds.has(batch.batchId) || batch.attempt.projectId !== input.coordinates.projectId ||
      Date.parse(batch.attempt.observedAt) > input.recordedAt.getTime()) {
      invalid("검색 추천 묶음의 ID·project·시각 좌표가 현재 context와 다릅니다.");
    }
    batchIds.add(batch.batchId);
    const selected = new Set(batch.selectedRecommendationIds);
    for (const recommendation of batch.recommendations) {
      if (recommendationIds.has(recommendation.recommendationId)) {
        invalid("같은 검색 추천이 context 입력에 중복되었습니다.");
      }
      recommendationIds.add(recommendation.recommendationId);
      if (recommendationIds.size > MAX_TOTAL_RECOMMENDATIONS) {
        invalid("검색 추천 수가 context 입력 한도를 넘었습니다.");
      }
      const candidate = input.candidates.get(recommendation.documentId);
      if (candidate === undefined) {
        invalid(`검색 추천 문서가 registry에 없습니다: ${recommendation.documentId}`);
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
      applied.push({ recommendation, selectionPolicy: batch.selectionPolicy });
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
  for (const { recommendation, selectionPolicy } of input.applied) {
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
    });
  }
}
