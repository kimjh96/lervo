export const SEARCH_ENGINE = { id: "lexical", version: 1 } as const;
export const SEARCH_MAX_RESULTS = 50;

export const searchSourceKinds = ["document", "skill", "verified_knowledge"] as const;
export type SearchSourceKind = (typeof searchSourceKinds)[number];

export interface SearchSourceReference {
  kind: SearchSourceKind;
  sourceId: string;
  contentHash: string;
  path?: string;
}

export interface SearchSourceInput extends SearchSourceReference {
  title?: string;
  labels: readonly string[];
  text: string;
}

export interface SearchHit {
  source: SearchSourceReference;
  rank: number;
  score: number;
  matchedFields: Array<"title" | "path" | "label" | "text">;
}

export interface SearchResponse {
  schemaVersion: 1;
  engine: typeof SEARCH_ENGINE;
  indexId: string;
  queryDigest: string;
  queryCharacterCount: number;
  queryTermCount: number;
  requestedLimit: number;
  hits: SearchHit[];
  resultSetHash: string;
}

export interface SearchAttemptHit {
  sourceKind: SearchSourceKind;
  sourceId: string;
  contentHash: string;
  rank: number;
  score: number;
}

export interface SearchAttempt {
  schemaVersion: 1;
  attemptId: string;
  projectId: string;
  observedAt: string;
  nonce: string;
  engine: typeof SEARCH_ENGINE;
  indexId: string;
  queryDigest: string;
  queryCharacterCount: number;
  queryTermCount: number;
  requestedLimit: number;
  resultSetHash: string;
  hits: SearchAttemptHit[];
}

export const searchFailureReasons = [
  "expected_source_missing",
  "insufficient_context",
  "low_rank",
  "no_results",
  "results_not_relevant",
] as const;
export type SearchFailureReason = (typeof searchFailureReasons)[number];

export interface SearchAssessmentSource {
  sourceKind: SearchSourceKind;
  sourceId: string;
}

export interface SearchAssessment {
  schemaVersion: 1;
  assessmentId: string;
  attemptId: string;
  projectId: string;
  assessedAt: string;
  assessor: "human" | "verification";
  outcome: "accepted" | "failed";
  failureReason: SearchFailureReason | null;
  selectedSources: SearchAssessmentSource[];
  expectedSources: SearchAssessmentSource[];
}

export interface SearchQualityReport {
  schemaVersion: 1;
  totalAttempts: number;
  assessedAttempts: number;
  unassessedAttempts: number;
  acceptedAttempts: number;
  failedAttempts: number;
  failuresByReason: Record<SearchFailureReason, number>;
  evidenceState: "failures_observed" | "insufficient_assessment" | "no_failures_observed";
  embeddingDecision: "not_determined";
}

export interface SearchRecommendation {
  schemaVersion: 1;
  recommendationId: string;
  batchId: string;
  sourceAttemptId: string;
  engine: typeof SEARCH_ENGINE;
  indexId: string;
  resultSetHash: string;
  sourceKind: "document";
  documentId: string;
  sourceContentHash: string;
  rank: number;
  score: number;
}

export interface SearchRecommendationBatch {
  schemaVersion: 1;
  batchId: string;
  attempt: SearchAttempt;
  recommendationLimit: number;
  selectionPolicy: {
    id: "top_ranked";
    version: 1;
    maximumSelections: number;
  };
  recommendations: SearchRecommendation[];
  selectedRecommendationIds: string[];
}

export type SearchErrorCode =
  | "assessment_conflict"
  | "corpus_invalid"
  | "corpus_limit_exceeded"
  | "invalid_assessment"
  | "invalid_attempt"
  | "invalid_evaluation_case"
  | "invalid_evaluation_result"
  | "invalid_evaluation_run"
  | "invalid_query"
  | "invalid_recommendation";

export class SearchError extends Error {
  constructor(readonly code: SearchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchError";
  }
}
