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

export interface SearchEngineSelection {
  mode: "baseline" | "candidate";
  candidateId: string | null;
  engine: SearchEngineIdentity;
  reviewId: string | null;
  comparisonId: string | null;
}

export interface SearchEngineActivation {
  schemaVersion: 1;
  activationId: string;
  projectId: string;
  sequence: number;
  previousActivationId: string | null;
  action: "activate_candidate" | "rollback";
  policyId: string;
  operatorId: string;
  decidedAt: string;
  previousSelection: SearchEngineSelection;
  selected: SearchEngineSelection;
  rollbackOfActivationId: string | null;
  rollbackTargetActivationId: string | null;
  applicationState: "not_connected";
  embeddingDecision: "not_determined";
}
