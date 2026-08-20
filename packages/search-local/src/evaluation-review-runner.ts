import {
  createSearchCandidateReview,
  sameSearchEngine,
  type SearchCandidateReview,
  type SearchCandidateReviewDecision,
  type SearchEvaluationEngineRegistration,
} from "@lervo/search";

import { executeLocalSearchCandidate } from "./evaluation-candidate-executor.js";
import { loadSearchEvaluationComparison } from "./evaluation-comparison-reader.js";
import { LocalSearchCandidateReviewStore } from "./evaluation-review-store.js";
import { SearchLocalError } from "./types.js";

export async function reviewLocalSearchCandidate(input: {
  repositoryRoot: string;
  projectId: string;
  comparisonId: string;
  registration: SearchEvaluationEngineRegistration;
  reviewerId: string;
  reviewedAt: Date;
  decision: SearchCandidateReviewDecision;
}): Promise<SearchCandidateReview> {
  const loaded = await loadSearchEvaluationComparison({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    comparisonId: input.comparisonId,
  });
  if (!sameSearchEngine(input.registration.engine.engine, loaded.comparison.candidate.engine)) {
    throw new SearchLocalError("evaluation_candidate_failed", "비교 원본의 후보가 현재 등록된 엔진과 다릅니다.");
  }
  if (loaded.comparison.schemaVersion !== 2 ||
    loaded.comparison.candidateAdapterBuildId !== input.registration.engine.adapterBuildId) {
    throw new SearchLocalError(
      "evaluation_candidate_build_mismatch",
      "비교 원본의 adapter build가 현재 등록된 구현과 다릅니다.",
    );
  }
  const replay = await executeLocalSearchCandidate({
    engine: input.registration.engine,
    corpus: loaded.evidence.corpus,
    cases: loaded.activeCases,
    evaluatedAt: new Date(loaded.comparison.evaluatedAt),
  });
  const review = createSearchCandidateReview({
    comparison: loaded.comparison,
    candidateId: input.registration.candidateId,
    cases: loaded.activeCases,
    replay,
    candidateAdapterBuildId: input.registration.engine.adapterBuildId,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    decision: input.decision,
  });
  const store = await LocalSearchCandidateReviewStore.open(input.repositoryRoot);
  await store.record(review);
  return review;
}
