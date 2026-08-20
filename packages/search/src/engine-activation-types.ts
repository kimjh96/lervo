import type { SearchEngineIdentity } from "./types.js";

export interface SearchEngineActivationPolicy {
  schemaVersion: 1;
  policyId: string;
  projectId: string;
  allowedReviewerIds: string[];
  allowedOperatorIds: string[];
  allowedCandidateIds: string[];
  minimumCandidateWins: number;
  maximumBaselineWins: 0;
  authoredBy: string;
  createdAt: string;
}

export interface BaselineSearchEngineSelection {
  mode: "baseline";
  candidateId: null;
  engine: SearchEngineIdentity;
  reviewId: null;
  comparisonId: null;
}

export interface CandidateSearchEngineSelection {
  mode: "candidate";
  candidateId: string;
  engine: SearchEngineIdentity;
  reviewId: string;
  comparisonId: string;
}

export type SearchEngineSelection = BaselineSearchEngineSelection | CandidateSearchEngineSelection;

interface SearchEngineActivationBase {
  activationId: string;
  projectId: string;
  sequence: number;
  previousActivationId: string | null;
  policyId: string;
  operatorId: string;
  decidedAt: string;
  previousSelection: SearchEngineSelection;
  selected: SearchEngineSelection;
  rollbackOfActivationId: string | null;
  embeddingDecision: "not_determined";
}

export interface LegacySearchEngineActivation extends SearchEngineActivationBase {
  schemaVersion: 1;
  action: "activate_candidate" | "rollback";
  rollbackTargetActivationId: string | null;
  applicationState?: "not_connected";
  recordState?: "selection_recorded";
}

interface SearchEngineActivationV2Base extends SearchEngineActivationBase {
  schemaVersion: 2;
  recordState: "selection_recorded";
  fallbackSelection: SearchEngineSelection;
  fallbackActivationId: string | null;
}

export interface SearchEngineCandidateActivation extends SearchEngineActivationV2Base {
  action: "activate_candidate";
  selected: CandidateSearchEngineSelection;
  rollbackOfActivationId: null;
}

export interface SearchEngineCandidateRefresh extends SearchEngineActivationV2Base {
  action: "refresh_candidate";
  previousSelection: CandidateSearchEngineSelection;
  selected: CandidateSearchEngineSelection;
  rollbackOfActivationId: null;
}

export interface SearchEngineRollback extends SearchEngineActivationV2Base {
  action: "rollback";
  rollbackOfActivationId: string;
}

export type SearchEngineActivation =
  | LegacySearchEngineActivation
  | SearchEngineCandidateActivation
  | SearchEngineCandidateRefresh
  | SearchEngineRollback;
