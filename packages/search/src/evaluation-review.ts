import { SEARCH_EVALUATION_BUNDLE_ID_PATTERN } from "./evaluation-bundle.js";
import {
  assertSearchEvaluationComparison,
  SEARCH_EVALUATION_COMPARISON_PATTERN,
} from "./evaluation-comparison.js";
import type { SearchEvaluationComparison } from "./evaluation-comparison-types.js";
import { SEARCH_CANDIDATE_ID_PATTERN } from "./evaluation-engine-registry.js";
import { assertSearchAdapterBuildId, assertSearchEngineIdentity, sameSearchEngine } from "./evaluation-engine.js";
import type { SearchEvaluationExecution } from "./evaluation-executor.js";
import { SEARCH_EVALUATION_RUN_PATTERN } from "./evaluation-common.js";
import { assertSearchEvaluationRun } from "./evaluation-run.js";
import type { SearchEvaluationCase } from "./evaluation-types.js";
import type {
  CurrentSearchCandidateReview,
  SearchCandidateReview,
  SearchCandidateReviewDecision,
} from "./evaluation-review-types.js";
import { contentId } from "./integrity.js";
import { SearchError } from "./types.js";
import { assertTimestamp, SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_CANDIDATE_REVIEW_PATTERN = /^scrv_[a-f0-9]{24}$/;

function promotionReadiness(decision: SearchCandidateReviewDecision): SearchCandidateReview["promotionReadiness"] {
  if (decision === "adopt_candidate") return "eligible_for_activation_review";
  if (decision === "reject_candidate") return "rejected";
  return "more_evidence_required";
}

function observedOutcome(baselineWins: number, candidateWins: number): SearchCandidateReview["observedOutcome"] {
  if (baselineWins > 0 && candidateWins > 0) return "mixed";
  if (candidateWins > 0) return "candidate_better_observed";
  if (baselineWins > 0) return "baseline_better_observed";
  return "no_difference_observed";
}

export function createSearchCandidateReview(input: {
  comparison: SearchEvaluationComparison;
  candidateId: string;
  cases: readonly SearchEvaluationCase[];
  replay: SearchEvaluationExecution;
  candidateAdapterBuildId: string;
  reviewerId: string;
  reviewedAt: Date;
  decision: SearchCandidateReviewDecision;
}): CurrentSearchCandidateReview {
  assertSearchEvaluationComparison(input.comparison);
  assertSearchEvaluationRun(input.replay.run, input.cases, input.replay.results);
  assertSearchAdapterBuildId(input.candidateAdapterBuildId, "invalid_candidate_review");
  if (!Number.isFinite(input.reviewedAt.getTime())) {
    throw new SearchError("invalid_candidate_review", "The candidate search review timestamp is invalid.");
  }
  if (input.comparison.schemaVersion !== 2 ||
    input.comparison.candidateAdapterBuildId !== input.candidateAdapterBuildId ||
    !SEARCH_CANDIDATE_ID_PATTERN.test(input.candidateId) || input.candidateId.length > 64 ||
    !SOURCE_ID_PATTERN.test(input.reviewerId) || input.replay.run.runId !== input.comparison.candidate.runId ||
    input.replay.run.indexId !== input.comparison.candidate.indexId ||
    !sameSearchEngine(input.replay.run.engine, input.comparison.candidate.engine) ||
    input.replay.run.projectId !== input.comparison.projectId ||
    input.replay.run.evaluatedAt !== input.comparison.evaluatedAt ||
    input.replay.run.caseIds.length !== input.comparison.cases.length ||
    input.replay.run.caseIds.some((caseId, index) => caseId !== input.comparison.cases[index]!.caseId)) {
    throw new SearchError("invalid_candidate_review", "Reviewer or candidate replay coordinates in the candidate search review are invalid.");
  }
  if (input.decision === "adopt_candidate" &&
    (input.comparison.candidateWins < 1 || input.comparison.baselineWins !== 0)) {
    throw new SearchError(
      "candidate_review_not_eligible",
      "A comparison with no candidate win or with a baseline regression cannot be reviewed for adoption.",
    );
  }
  const core = {
    projectId: input.comparison.projectId,
    bundleId: input.comparison.bundleId,
    bundleHash: input.comparison.bundleHash,
    coverageId: input.comparison.coverageId,
    comparisonId: input.comparison.comparisonId,
    corpusDigest: input.comparison.corpusDigest,
    candidateId: input.candidateId,
    candidate: { ...input.comparison.candidate.engine },
    candidateAdapterBuildId: input.candidateAdapterBuildId,
    candidateRunId: input.comparison.candidate.runId,
    replayRunId: input.replay.run.runId,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt.toISOString(),
    decision: input.decision,
    observedOutcome: input.comparison.observedOutcome,
    totalCases: input.comparison.totalCases,
    baselineWins: input.comparison.baselineWins,
    candidateWins: input.comparison.candidateWins,
    ties: input.comparison.ties,
    verification: {
      comparisonIntegrity: "verified" as const,
      candidateReplay: "matched" as const,
    },
    promotionReadiness: promotionReadiness(input.decision),
    activationState: "not_applied" as const,
    embeddingDecision: "not_determined" as const,
  };
  const review: CurrentSearchCandidateReview = {
    schemaVersion: 2,
    reviewId: contentId("scrv", core),
    ...core,
  };
  assertSearchCandidateReview(review);
  return review;
}

export function assertSearchCandidateReview(review: SearchCandidateReview): void {
  if (![1, 2].includes(review.schemaVersion) || !SEARCH_CANDIDATE_REVIEW_PATTERN.test(review.reviewId) ||
    !SOURCE_ID_PATTERN.test(review.projectId) || !SEARCH_EVALUATION_BUNDLE_ID_PATTERN.test(review.bundleId) ||
    review.bundleId.length > 100 || !SHA256_PATTERN.test(review.bundleHash) ||
    !/^secov_[a-f0-9]{24}$/.test(review.coverageId) ||
    !SEARCH_EVALUATION_COMPARISON_PATTERN.test(review.comparisonId) || !SHA256_PATTERN.test(review.corpusDigest) ||
    !SEARCH_CANDIDATE_ID_PATTERN.test(review.candidateId) || review.candidateId.length > 64 ||
    !SEARCH_EVALUATION_RUN_PATTERN.test(review.candidateRunId) || review.replayRunId !== review.candidateRunId ||
    !SOURCE_ID_PATTERN.test(review.reviewerId) ||
    !["adopt_candidate", "reject_candidate", "more_samples_required"].includes(review.decision) ||
    !["baseline_better_observed", "candidate_better_observed", "mixed", "no_difference_observed"]
      .includes(review.observedOutcome) ||
    !Number.isSafeInteger(review.totalCases) || review.totalCases < 1 ||
    !Number.isSafeInteger(review.baselineWins) || review.baselineWins < 0 ||
    !Number.isSafeInteger(review.candidateWins) || review.candidateWins < 0 ||
    !Number.isSafeInteger(review.ties) || review.ties < 0 ||
    review.verification?.comparisonIntegrity !== "verified" || review.verification?.candidateReplay !== "matched" ||
    review.promotionReadiness !== promotionReadiness(review.decision) || review.activationState !== "not_applied" ||
    review.embeddingDecision !== "not_determined" ||
    review.baselineWins + review.candidateWins + review.ties !== review.totalCases ||
    (review.decision === "adopt_candidate" && (review.candidateWins < 1 || review.baselineWins !== 0))) {
    throw new SearchError("invalid_candidate_review", "The candidate search review contract is invalid.");
  }
  assertSearchEngineIdentity(review.candidate, "invalid_candidate_review");
  if (review.schemaVersion === 2) {
    assertSearchAdapterBuildId(review.candidateAdapterBuildId, "invalid_candidate_review");
  }
  assertTimestamp(review.reviewedAt, "invalid_candidate_review");
  if (review.observedOutcome !== observedOutcome(review.baselineWins, review.candidateWins)) {
    throw new SearchError("invalid_candidate_review", "The candidate search review observation summary is invalid.");
  }
  const { schemaVersion: _schema, reviewId: _id, ...core } = review;
  if (contentId("scrv", core) !== review.reviewId) {
    throw new SearchError("invalid_candidate_review", "The candidate search review ID does not match its content.");
  }
}
