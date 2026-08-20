import {
  createSearchCandidateReview,
  sameSearchEngine,
  type SearchCandidateReview,
  type SearchEnginePort,
  type SearchEvaluationComparison,
  type SearchEvaluationEngineRegistry,
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
  corpus: readonly SearchSourceInput[];
}

export async function verifySearchCandidateActivationEvidence(input: {
  repositoryRoot: string;
  projectId: string;
  reviewId: string;
  registry: SearchEvaluationEngineRegistry;
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
  const replay = await executeLocalSearchCandidate({
    engine,
    corpus: loaded.evidence.corpus,
    cases: loaded.activeCases,
    evaluatedAt: new Date(loaded.comparison.evaluatedAt),
  });
  const recreated = createSearchCandidateReview({
    comparison: loaded.comparison,
    candidateId: review.candidateId,
    cases: loaded.activeCases,
    replay,
    reviewerId: review.reviewerId,
    reviewedAt: new Date(review.reviewedAt),
    decision: review.decision,
  });
  if (recreated.reviewId !== review.reviewId) {
    throw new SearchLocalError("observation_invalid", "검색 후보 검토가 현재 원본과 재현 결과에 맞지 않습니다.");
  }
  return {
    review,
    comparison: loaded.comparison,
    engine,
    corpus: structuredClone(loaded.evidence.corpus),
  };
}
