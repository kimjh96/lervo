import type { SearchEngineIdentity, SearchFailureReason } from "./types.js";

export const searchRolloutReviewDecisions = [
  "keep_candidate",
  "rollback_recommended",
  "more_assessments_required",
] as const;

export type SearchRolloutReviewDecision = (typeof searchRolloutReviewDecisions)[number];

export interface SearchRolloutReviewTarget {
  selectionTransitionId: string;
  candidateId: string;
  engine: SearchEngineIdentity;
  adapterBuildId: string;
  candidateReviewId: string;
}

export interface SearchRolloutQualitySnapshot {
  snapshotId: string;
  inputDigest: string;
  observedThrough: string;
  totalAttempts: number;
  assessedAttempts: number;
  unassessedAttempts: number;
  acceptedAttempts: number;
  failedAttempts: number;
  failuresByReason: Record<SearchFailureReason, number>;
  evidenceState: "failures_observed" | "insufficient_assessment" | "no_failures_observed";
}

export interface SearchRolloutReview {
  schemaVersion: 1;
  rolloutReviewId: string;
  projectId: string;
  target: SearchRolloutReviewTarget;
  qualitySnapshot: SearchRolloutQualitySnapshot;
  reviewerId: string;
  reviewedAt: string;
  decision: SearchRolloutReviewDecision;
  thresholdPolicyState: "not_defined";
  effect: {
    selectionChange: "not_applied";
    rollback: "not_executed";
    approval: "not_granted";
  };
  embeddingDecision: "not_determined";
}
