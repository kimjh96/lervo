import type { SearchEngineIdentity } from "./types.js";

export type SearchEvaluationCaseComparisonOutcome = "baseline_win" | "candidate_win" | "tie";

export interface SearchEvaluationCaseComparison {
  caseId: string;
  baselineResultId: string;
  candidateResultId: string;
  outcome: SearchEvaluationCaseComparisonOutcome;
}

export interface SearchEvaluationComparisonRunReference {
  engine: SearchEngineIdentity;
  indexId: string;
  runId: string;
}

interface SearchEvaluationComparisonBase {
  comparisonId: string;
  projectId: string;
  bundleId: string;
  bundleHash: string;
  coverageId: string;
  corpusDigest: string;
  evaluatedAt: string;
  baseline: SearchEvaluationComparisonRunReference;
  candidate: SearchEvaluationComparisonRunReference;
  cases: SearchEvaluationCaseComparison[];
  totalCases: number;
  baselineWins: number;
  candidateWins: number;
  ties: number;
  observedOutcome:
    | "baseline_better_observed"
    | "candidate_better_observed"
    | "mixed"
    | "no_difference_observed";
  candidateDecision: "not_determined";
  embeddingDecision: "not_determined";
}

export interface LegacySearchEvaluationComparison extends SearchEvaluationComparisonBase {
  schemaVersion: 1;
}

export interface CurrentSearchEvaluationComparison extends SearchEvaluationComparisonBase {
  schemaVersion: 2;
  candidateAdapterBuildId: string;
}

export type SearchEvaluationComparison = LegacySearchEvaluationComparison | CurrentSearchEvaluationComparison;
