import { assertSearchAttempt } from "./attempt.js";
import { canonicalHash, contentId } from "./integrity.js";
import {
  SearchError,
  type SearchRecommendation,
  type SearchRecommendationBatch,
  type SearchAttempt,
} from "./types.js";

const MAX_RECOMMENDATIONS = 20;
const MAX_SELECTIONS = 5;

function invalid(message: string): never {
  throw new SearchError("invalid_recommendation", message);
}

function buildBatch(input: {
  attempt: SearchAttempt;
  recommendationLimit: number;
  maximumSelections: number;
}): SearchRecommendationBatch {
  assertSearchAttempt(input.attempt);
  if (!Number.isSafeInteger(input.recommendationLimit) || input.recommendationLimit < 1 ||
    input.recommendationLimit > MAX_RECOMMENDATIONS ||
    !Number.isSafeInteger(input.maximumSelections) || input.maximumSelections < 0 ||
    input.maximumSelections > MAX_SELECTIONS || input.maximumSelections > input.recommendationLimit) {
    invalid("The search recommendation or selection limit is invalid.");
  }
  const cores = input.attempt.hits
    .filter((hit) => hit.sourceKind === "document")
    .slice(0, input.recommendationLimit)
    .map((hit) => ({
      sourceAttemptId: input.attempt.attemptId,
      engine: input.attempt.engine,
      selectionTransitionId: input.attempt.selectionTransitionId,
      indexId: input.attempt.indexId,
      resultSetHash: input.attempt.resultSetHash,
      sourceKind: "document" as const,
      documentId: hit.sourceId,
      sourceContentHash: hit.contentHash,
      rank: hit.rank,
      score: hit.score,
    }));
  const recommendationIds = cores.map((core) => contentId("srec", core));
  const selectionPolicy = {
    id: "top_ranked" as const,
    version: 1 as const,
    maximumSelections: input.maximumSelections,
  };
  const batchId = contentId("srb", {
    attemptId: input.attempt.attemptId,
    recommendationLimit: input.recommendationLimit,
    selectionPolicy,
    recommendationIds,
  });
  const recommendations: SearchRecommendation[] = cores.map((core, index) => ({
    schemaVersion: 1,
    recommendationId: recommendationIds[index]!,
    batchId,
    ...core,
  }));
  return {
    schemaVersion: 1,
    batchId,
    attempt: structuredClone(input.attempt),
    recommendationLimit: input.recommendationLimit,
    selectionPolicy,
    recommendations,
    selectedRecommendationIds: recommendations
      .slice(0, input.maximumSelections)
      .map((recommendation) => recommendation.recommendationId),
  };
}

export function createSearchRecommendationBatch(input: {
  attempt: SearchAttempt;
  recommendationLimit?: number;
  maximumSelections?: number;
}): SearchRecommendationBatch {
  return buildBatch({
    attempt: input.attempt,
    recommendationLimit: input.recommendationLimit ?? 5,
    maximumSelections: input.maximumSelections ?? 3,
  });
}

export function assertSearchRecommendationBatch(batch: SearchRecommendationBatch): void {
  if (typeof batch !== "object" || batch === null || batch.schemaVersion !== 1 ||
    typeof batch.attempt !== "object" || batch.attempt === null ||
    typeof batch.selectionPolicy !== "object" || batch.selectionPolicy === null ||
    batch.selectionPolicy.id !== "top_ranked" || batch.selectionPolicy.version !== 1 ||
    !Array.isArray(batch.recommendations) || !Array.isArray(batch.selectedRecommendationIds)) {
    invalid("The search recommendation batch contract is invalid.");
  }
  const expected = buildBatch({
    attempt: batch.attempt,
    recommendationLimit: batch.recommendationLimit,
    maximumSelections: batch.selectionPolicy.maximumSelections,
  });
  if (canonicalHash(batch) !== canonicalHash(expected)) {
    invalid("The search recommendation batch does not match its source search attempt.");
  }
}
