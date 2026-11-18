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
  productQualificationId?: string | null;
  indexId: string;
  queryDigest: string;
  queryCharacterCount: number;
  queryTermCount: number;
  requestedLimit: number;
  resultSetHash: string;
  hits: SearchAttemptHit[];
}

export interface SearchRecommendation {
  schemaVersion: 1;
  recommendationId: string;
  batchId: string;
  sourceAttemptId: string;
  engine: SearchEngineIdentity;
  selectionTransitionId: string | null;
  productQualificationId?: string | null;
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
  | "corpus_invalid"
  | "corpus_limit_exceeded"
  | "invalid_attempt"
  | "evaluation_candidate_not_registered"
  | "invalid_evaluation_engine"
  | "invalid_query"
  | "invalid_query_projection"
  | "invalid_retrieval_plan"
  | "invalid_recommendation";

export class SearchError extends Error {
  constructor(
    readonly code: SearchErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SearchError";
  }
}
