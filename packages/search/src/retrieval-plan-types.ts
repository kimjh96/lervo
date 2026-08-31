import type { SearchEngineIdentity } from "./types.js";
import type { SearchQueryProjectorIdentity } from "./query-projection.js";

export interface SearchRetrievalPlan {
  schemaVersion: 1;
  planId: string;
  projection: {
    required: true;
    populations: Array<{ populationId: string; projector: SearchQueryProjectorIdentity }>;
    maximumQueries: number;
    maximumQueryCharacters: number;
  };
  retrieval: {
    stageId: "primary_retrieval";
    candidateId: string;
    engine: SearchEngineIdentity;
    adapterBuildId: string;
    perQueryLimit: number;
  };
  fusion: {
    algorithm: "query_coverage_interleave" | "reciprocal_rank_fusion";
    version: 1;
  };
  finalLimit: number;
  failurePolicy: "fail_closed";
  privacy: {
    requestText: "excluded";
    contextText: "excluded";
    projectedQueryText: "excluded";
    credentials: "excluded";
  };
}

export interface SearchRetrievalPlanReview {
  schemaVersion: 1;
  reviewId: string;
  planId: string;
  reviewerId: string;
  reviewedAt: string;
  decision: "activate";
  corpus: {
    sourceSnapshotId: string;
    digest: string;
    documentCount: number;
    byteCount: number;
  };
  suite: { suiteId: string; bindingHash: string; cases: number; repetitions: number };
  populations: Array<{
    populationId: string;
    reportId: string;
    reportHash: string;
    passedObservations: number;
    totalObservations: number;
    usageComplete: boolean;
    projectionFailures: number;
    durationWithinLimit: boolean;
  }>;
  engineEvidence: {
    evidencePath: string;
    evidenceHash: string;
    qualityGatePassed: true;
    efficiencyGatePassed: true;
  };
}

export interface SearchRetrievalPlanPolicy {
  schemaVersion: 1;
  policyId: string;
  projectId: string;
  allowedPlanIds: string[];
  reviewerIds: string[];
  operatorIds: string[];
  authorId: string;
  createdAt: string;
  minimumPopulations: number;
  requirePerfectObservationPass: true;
  requireCompleteUsage: true;
  requireZeroProjectionFailures: true;
  requireDurationWithinLimit: true;
}

export interface SearchRetrievalPlanActivationBundle {
  schemaVersion: 1;
  bundleId: string;
  plan: SearchRetrievalPlan;
  review: SearchRetrievalPlanReview;
  policy: SearchRetrievalPlanPolicy;
}

export type SearchRetrievalPlanSelection =
  | { mode: "baseline"; planId: null; reviewId: null; bundleId: null }
  | { mode: "candidate"; planId: string; reviewId: string; bundleId: string };

export interface SearchRetrievalPlanActivation {
  schemaVersion: 1;
  activationId: string;
  projectId: string;
  sequence: number;
  previousActivationId: string | null;
  action: "activate_plan" | "rollback";
  policyId: string;
  operatorId: string;
  decidedAt: string;
  selected: SearchRetrievalPlanSelection;
  rollbackTarget: SearchRetrievalPlanSelection;
}
