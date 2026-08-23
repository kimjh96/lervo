import { assertSearchEvaluationComparison } from "./evaluation-comparison.js";
import type { SearchEvaluationComparison } from "./evaluation-comparison-types.js";
import {
  assertSearchAdapterBuildId,
  assertSearchEngineIdentity,
  SEARCH_INDEX_ID_PATTERN,
  sameSearchEngine,
} from "./evaluation-engine.js";
import { SEARCH_EVALUATION_RUN_PATTERN } from "./evaluation-common.js";
import { assertSearchCandidateReview, SEARCH_CANDIDATE_REVIEW_PATTERN } from "./evaluation-review.js";
import type { SearchCandidateReview } from "./evaluation-review-types.js";
import { contentId } from "./integrity.js";
import { SearchError, type SearchEngineIdentity } from "./types.js";
import { SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_CANDIDATE_VERIFICATION_RECEIPT_PATTERN = /^sevrf_[a-f0-9]{24}$/;

export interface SearchCandidateVerificationReceipt {
  schemaVersion: 1;
  receiptId: string;
  projectId: string;
  candidateId: string;
  engine: SearchEngineIdentity;
  adapterBuildId: string;
  comparisonId: string;
  reviewId: string;
  corpusDigest: string;
  candidateRunId: string;
  indexId: string;
  verificationState: "replayed";
}

export function createSearchCandidateVerificationReceipt(input: {
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
  adapterBuildId: string;
  replayRunId: string;
  indexId: string;
}): SearchCandidateVerificationReceipt {
  assertSearchCandidateReview(input.review);
  assertSearchEvaluationComparison(input.comparison);
  assertSearchAdapterBuildId(input.adapterBuildId);
  if (input.review.schemaVersion !== 2 || input.comparison.schemaVersion !== 2 ||
    input.review.comparisonId !== input.comparison.comparisonId ||
    input.review.projectId !== input.comparison.projectId ||
    input.review.corpusDigest !== input.comparison.corpusDigest ||
    input.review.candidateRunId !== input.comparison.candidate.runId ||
    input.review.candidateAdapterBuildId !== input.adapterBuildId ||
    input.comparison.candidateAdapterBuildId !== input.adapterBuildId ||
    !sameSearchEngine(input.review.candidate, input.comparison.candidate.engine) ||
    input.replayRunId !== input.review.replayRunId || input.indexId !== input.comparison.candidate.indexId) {
    throw new SearchError("invalid_candidate_review", "Candidate search verification receipt sources differ.");
  }
  const core = {
    projectId: input.review.projectId,
    candidateId: input.review.candidateId,
    engine: { ...input.review.candidate },
    adapterBuildId: input.adapterBuildId,
    comparisonId: input.comparison.comparisonId,
    reviewId: input.review.reviewId,
    corpusDigest: input.review.corpusDigest,
    candidateRunId: input.replayRunId,
    indexId: input.indexId,
    verificationState: "replayed" as const,
  };
  const receipt: SearchCandidateVerificationReceipt = {
    schemaVersion: 1,
    receiptId: contentId("sevrf", core),
    ...core,
  };
  assertSearchCandidateVerificationReceipt(receipt);
  return receipt;
}

export function assertSearchCandidateVerificationReceipt(receipt: SearchCandidateVerificationReceipt): void {
  if (receipt.schemaVersion !== 1 ||
    !SEARCH_CANDIDATE_VERIFICATION_RECEIPT_PATTERN.test(receipt.receiptId) ||
    !SOURCE_ID_PATTERN.test(receipt.projectId) || !SOURCE_ID_PATTERN.test(receipt.candidateId) ||
    !SEARCH_CANDIDATE_REVIEW_PATTERN.test(receipt.reviewId) ||
    !/^secmp_[a-f0-9]{24}$/.test(receipt.comparisonId) ||
    !SHA256_PATTERN.test(receipt.corpusDigest) ||
    !SEARCH_EVALUATION_RUN_PATTERN.test(receipt.candidateRunId) ||
    !SEARCH_INDEX_ID_PATTERN.test(receipt.indexId) || receipt.verificationState !== "replayed") {
    throw new SearchError("invalid_candidate_review", "The candidate search verification receipt contract is invalid.");
  }
  assertSearchEngineIdentity(receipt.engine, "invalid_candidate_review");
  assertSearchAdapterBuildId(receipt.adapterBuildId, "invalid_candidate_review");
  const { schemaVersion: _schema, receiptId: _id, ...core } = receipt;
  if (contentId("sevrf", core) !== receipt.receiptId) {
    throw new SearchError("invalid_candidate_review", "The candidate search verification receipt ID does not match its content.");
  }
}
