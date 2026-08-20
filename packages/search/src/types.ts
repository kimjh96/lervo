export const SEARCH_ENGINE = { id: "lexical", version: 1 } as const;
export const SEARCH_MAX_RESULTS = 50;

export interface SearchEngineIdentity {
  id: string;
  version: number;
}

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
  engine: SearchEngineIdentity;
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
  engine: SearchEngineIdentity;
  selectionTransitionId: string | null;
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

export interface SearchSelectionQualityCoordinate {
  selectionTransitionId: string | null;
  engine: SearchEngineIdentity;
  selectionState: "implicit_baseline" | "recorded_baseline" | "candidate";
  adapterBuildId: string | null;
  buildEvidenceState: "not_applicable" | "bound" | "legacy_unbound";
}

export interface SearchSelectionQualitySlice extends SearchSelectionQualityCoordinate {
  totalAttempts: number;
  assessedAttempts: number;
  unassessedAttempts: number;
  acceptedAttempts: number;
  failedAttempts: number;
  failuresByReason: Record<SearchFailureReason, number>;
  evidenceState: "failures_observed" | "insufficient_assessment" | "no_failures_observed";
}

export interface SearchSelectionQualityReport extends Omit<SearchQualityReport, "schemaVersion"> {
  schemaVersion: 2;
  selections: SearchSelectionQualitySlice[];
  rolloutDecision: "not_determined";
  rollbackDecision: "not_determined";
}

export interface SearchRecommendation {
  schemaVersion: 1;
  recommendationId: string;
  batchId: string;
  sourceAttemptId: string;
  engine: SearchEngineIdentity;
  selectionTransitionId: string | null;
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
  | "invalid_evaluation_bundle"
  | "invalid_evaluation_coverage"
  | "evaluation_comparison_not_ready"
  | "evaluation_candidate_not_registered"
  | "candidate_review_not_eligible"
  | "engine_activation_not_eligible"
  | "invalid_engine_activation"
  | "invalid_engine_activation_policy"
  | "invalid_candidate_review"
  | "invalid_evaluation_comparison"
  | "invalid_evaluation_engine"
  | "invalid_evaluation_result"
  | "invalid_evaluation_run"
  | "invalid_query"
  | "invalid_recommendation"
  | "invalid_rollout_review"
  | "invalid_rollout_status";

export class SearchError extends Error {
  constructor(readonly code: SearchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchError";
  }
}
