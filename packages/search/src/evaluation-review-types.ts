import type { SearchEngineIdentity } from "./types.js";

export type SearchCandidateReviewDecision =
  | "adopt_candidate"
  | "reject_candidate"
  | "more_samples_required";

interface SearchCandidateReviewBase {
  reviewId: string;
  projectId: string;
  bundleId: string;
  bundleHash: string;
  coverageId: string;
  comparisonId: string;
  corpusDigest: string;
  candidateId: string;
  candidate: SearchEngineIdentity;
  candidateRunId: string;
  replayRunId: string;
  reviewerId: string;
  reviewedAt: string;
  decision: SearchCandidateReviewDecision;
  observedOutcome: "baseline_better_observed" | "candidate_better_observed" | "mixed" |
    "no_difference_observed";
  totalCases: number;
  baselineWins: number;
  candidateWins: number;
  ties: number;
  verification: {
    comparisonIntegrity: "verified";
    candidateReplay: "matched";
  };
  promotionReadiness: "eligible_for_activation_review" | "rejected" | "more_evidence_required";
  activationState: "not_applied";
  embeddingDecision: "not_determined";
}

export interface LegacySearchCandidateReview extends SearchCandidateReviewBase {
  schemaVersion: 1;
}

export interface CurrentSearchCandidateReview extends SearchCandidateReviewBase {
  schemaVersion: 2;
  candidateAdapterBuildId: string;
}

export type SearchCandidateReview = LegacySearchCandidateReview | CurrentSearchCandidateReview;
