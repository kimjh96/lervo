import {
  createSearchCandidateReview,
  createSearchCandidateVerificationReceipt,
  sameSearchEngine,
  type SearchCandidateReview,
  type SearchCandidateVerificationReceipt,
  type SearchCandidateEngineResolver,
  type SearchEnginePort,
  type SearchEvaluationComparison,
  type SearchIndexPort,
  type SearchSourceInput,
} from "@lervo/search";

import { executeLocalSearchCandidate } from "./evaluation-candidate-executor.js";
import { loadSearchEvaluationComparison } from "./evaluation-comparison-reader.js";
import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { SearchLocalError } from "./types.js";

export interface VerifiedSearchCandidateActivationEvidence {
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
  engine: SearchEnginePort;
  index: SearchIndexPort;
  corpus: readonly SearchSourceInput[];
  verificationReceipt: SearchCandidateVerificationReceipt | null;
}

export async function verifySearchCandidateActivationEvidence(input: {
  repositoryRoot: string;
  projectId: string;
  reviewId: string;
  registry: SearchCandidateEngineResolver;
}): Promise<VerifiedSearchCandidateActivationEvidence> {
  const review = await loadStoredSearchCandidateReview(input.repositoryRoot, input.reviewId);
  if (review.projectId !== input.projectId) {
    throw new SearchLocalError("observation_invalid", "검색 후보 검토의 project 좌표가 다릅니다.");
  }
  const loaded = await loadSearchEvaluationComparison({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    comparisonId: review.comparisonId,
  });
  const engine = input.registry.resolve(review.candidateId);
  if (!sameSearchEngine(engine.engine, review.candidate)) {
    throw new SearchLocalError("evaluation_candidate_failed", "검토 원본의 후보가 현재 등록된 엔진과 다릅니다.");
  }
  if (review.schemaVersion !== loaded.comparison.schemaVersion) {
    throw new SearchLocalError(
      "evaluation_candidate_build_mismatch",
      "검토와 비교 원본의 adapter build 계약 version이 다릅니다.",
    );
  }
  if (review.schemaVersion === 2 && loaded.comparison.schemaVersion === 2 &&
    (review.candidateAdapterBuildId !== engine.adapterBuildId ||
      loaded.comparison.candidateAdapterBuildId !== engine.adapterBuildId)) {
    throw new SearchLocalError(
      "evaluation_candidate_build_mismatch",
      "검토·비교 원본의 adapter build가 현재 등록된 구현과 다릅니다.",
    );
  }
  const replay = await executeLocalSearchCandidate({
    engine,
    corpus: loaded.evidence.corpus,
    cases: loaded.activeCases,
    evaluatedAt: new Date(loaded.comparison.evaluatedAt),
  });
  const recreatedReviewId = review.schemaVersion === 2 && loaded.comparison.schemaVersion === 2
    ? createSearchCandidateReview({
      comparison: loaded.comparison,
      candidateId: review.candidateId,
      cases: loaded.activeCases,
      replay,
      candidateAdapterBuildId: engine.adapterBuildId,
      reviewerId: review.reviewerId,
      reviewedAt: new Date(review.reviewedAt),
      decision: review.decision,
    }).reviewId
    : replay.run.runId === review.replayRunId ? review.reviewId : null;
  if (recreatedReviewId !== review.reviewId) {
    throw new SearchLocalError("observation_invalid", "검색 후보 검토가 현재 원본과 재현 결과에 맞지 않습니다.");
  }
  const verificationReceipt = review.schemaVersion === 2 && loaded.comparison.schemaVersion === 2
    ? createSearchCandidateVerificationReceipt({
      review,
      comparison: loaded.comparison,
      adapterBuildId: engine.adapterBuildId,
      replayRunId: replay.run.runId,
      indexId: replay.index.indexId,
    })
    : null;
  return {
    review,
    comparison: loaded.comparison,
    engine,
    index: replay.index,
    corpus: structuredClone(loaded.evidence.corpus),
    verificationReceipt,
  };
}
