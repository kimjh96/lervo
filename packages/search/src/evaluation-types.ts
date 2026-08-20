import type {
  SearchAssessmentSource,
  SearchAttemptHit,
  SearchFailureReason,
  SearchEngineIdentity,
  SearchSourceKind,
} from "./types.js";

export const SEARCH_EVALUATION_MAX_CASES = 256;

export const searchEvaluationFailureReasons = [
  "expected_source_missing",
  "low_rank",
  "no_results",
] as const;

export type SearchEvaluationFailureReason = (typeof searchEvaluationFailureReasons)[number];
export type SearchEvaluationStatus = "passed" | "failed";

export interface SearchEvaluationExpectation {
  matchMode: "any" | "all";
  maximumRank: number;
  sources: SearchAssessmentSource[];
}

export interface SearchEvaluationCase {
  schemaVersion: 1;
  caseId: string;
  projectId: string;
  query: string;
  queryDigest: string;
  queryCharacterCount: number;
  queryTermCount: number;
  expectation: SearchEvaluationExpectation;
  review: {
    attemptId: string;
    assessmentId: string;
    assessor: "human" | "verification";
    assessedAt: string;
    outcome: "accepted" | "failed";
    failureReason: SearchFailureReason | null;
    indexId: string;
    resultSetHash: string;
    referenceRequestedLimit: number;
    referenceStatus: SearchEvaluationStatus;
    referenceExpectedSourceRanks: SearchEvaluationSourceRank[];
  };
}

export interface SearchEvaluationSourceRank {
  sourceKind: SearchSourceKind;
  sourceId: string;
  rank: number | null;
}

export interface SearchEvaluationResult {
  schemaVersion: 1;
  resultId: string;
  caseId: string;
  projectId: string;
  evaluatedAt: string;
  engine: SearchEngineIdentity;
  indexId: string;
  queryDigest: string;
  requestedLimit: number;
  returnedHits: number;
  resultSetHash: string;
  hits: SearchAttemptHit[];
  status: SearchEvaluationStatus;
  failureReason: SearchEvaluationFailureReason | null;
  expectedSourceRanks: SearchEvaluationSourceRank[];
  comparisonToReference: "improved" | "unchanged" | "regressed";
  embeddingDecision: "not_determined";
}

export interface SearchEvaluationRun {
  schemaVersion: 1;
  runId: string;
  projectId: string;
  evaluatedAt: string;
  engine: SearchEngineIdentity;
  indexId: string;
  caseIds: string[];
  resultIds: string[];
  totalCases: number;
  passedCases: number;
  failedCases: number;
  regressions: number;
  improvements: number;
  failuresByReason: Record<SearchEvaluationFailureReason, number>;
  baselineState: "all_passed" | "failures_observed";
  embeddingDecision: "not_determined";
}
