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
    throw new SearchLocalError("evaluation_candidate_failed", "The candidate in the comparison source differs from the currently registered engine.");
  }
  if (loaded.comparison.schemaVersion !== 2 ||
    loaded.comparison.candidateAdapterBuildId !== input.registration.engine.adapterBuildId) {
    throw new SearchLocalError(
      "evaluation_candidate_build_mismatch",
      "The adapter build in the comparison source differs from the currently registered implementation.",
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
