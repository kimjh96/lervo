export const SEARCH_EVALUATION_MAX_BUNDLES = 32;
export const SEARCH_EVALUATION_MAX_ACTIVE_CASES = 64;
export const SEARCH_EVALUATION_MAX_REPLACEMENTS = 192;

export interface SearchEvaluationCaseReplacement {
  replacedCaseId: string;
  replacementCaseId: string;
}

export interface SearchEvaluationBundle {
  schemaVersion: 1;
  bundleId: string;
  bundleHash: string;
  projectId: string;
  scope: {
    roleId: string;
    taskType: string;
  };
  minimumActiveCases: number;
  activeCaseIds: string[];
  replacements: SearchEvaluationCaseReplacement[];
}

export interface SearchEvaluationCoverage {
  schemaVersion: 1;
  coverageId: string;
  projectId: string;
  bundleId: string;
  bundleHash: string;
  scope: SearchEvaluationBundle["scope"];
  minimumActiveCases: number;
  activeCaseIds: string[];
  replacementCount: number;
  activeCases: number;
  shortfall: number;
  sampleState: "sufficient" | "insufficient";
  comparisonReadiness: "ready" | "insufficient_sample";
  embeddingDecision: "not_determined";
}
