import type {
  BaselineSearchEngineSelection,
  CandidateSearchEngineSelection,
  SearchEngineSelection,
} from "./engine-activation-types.js";
import { SEARCH_CANDIDATE_ID_PATTERN } from "./evaluation-engine-registry.js";
import { SEARCH_EVALUATION_COMPARISON_PATTERN } from "./evaluation-comparison.js";
import { SEARCH_CANDIDATE_REVIEW_PATTERN } from "./evaluation-review.js";
import type { SearchCandidateReview } from "./evaluation-review-types.js";
import { assertSearchEngineIdentity, sameSearchEngine } from "./evaluation-engine.js";
import { SEARCH_ENGINE, SearchError } from "./types.js";

export function baselineSearchEngineSelection(): BaselineSearchEngineSelection {
  return {
    mode: "baseline",
    candidateId: null,
    engine: { ...SEARCH_ENGINE },
    reviewId: null,
    comparisonId: null,
  };
}

export function candidateSearchEngineSelection(
  review: SearchCandidateReview,
): CandidateSearchEngineSelection {
  return {
    mode: "candidate",
    candidateId: review.candidateId,
    engine: { ...review.candidate },
    reviewId: review.reviewId,
    comparisonId: review.comparisonId,
  };
}

export function sameSearchEngineSelection(
  left: SearchEngineSelection,
  right: SearchEngineSelection,
): boolean {
  return (
    left.mode === right.mode &&
    left.candidateId === right.candidateId &&
    sameSearchEngine(left.engine, right.engine) &&
    left.reviewId === right.reviewId &&
    left.comparisonId === right.comparisonId
  );
}

export function assertSearchEngineSelection(selection: SearchEngineSelection): void {
  if (
    typeof selection !== "object" ||
    selection === null ||
    !["baseline", "candidate"].includes(selection.mode)
  ) {
    throw new SearchError(
      "invalid_engine_activation",
      "The search engine selection coordinates are invalid.",
    );
  }
  assertSearchEngineIdentity(selection.engine, "invalid_engine_activation");
  if (selection.mode === "baseline") {
    if (
      selection.candidateId !== null ||
      selection.reviewId !== null ||
      selection.comparisonId !== null ||
      !sameSearchEngine(selection.engine, SEARCH_ENGINE)
    ) {
      throw new SearchError(
        "invalid_engine_activation",
        "The baseline search engine selection coordinates are invalid.",
      );
    }
    return;
  }
  if (
    selection.candidateId === null ||
    !SEARCH_CANDIDATE_ID_PATTERN.test(selection.candidateId) ||
    selection.reviewId === null ||
    !SEARCH_CANDIDATE_REVIEW_PATTERN.test(selection.reviewId) ||
    selection.comparisonId === null ||
    !SEARCH_EVALUATION_COMPARISON_PATTERN.test(selection.comparisonId) ||
    sameSearchEngine(selection.engine, SEARCH_ENGINE)
  ) {
    throw new SearchError(
      "invalid_engine_activation",
      "The candidate search engine selection coordinates are invalid.",
    );
  }
}
