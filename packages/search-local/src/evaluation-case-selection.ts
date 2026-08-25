import type { SearchEvaluationCase } from "@lervo/search";

import { SearchLocalError } from "./types.js";

export function selectSearchEvaluationCases(
  availableCases: readonly SearchEvaluationCase[],
  caseIds: readonly string[],
): SearchEvaluationCase[] {
  const requested = new Set(caseIds);
  if (requested.size !== caseIds.length || requested.size === 0) {
    throw new SearchLocalError(
      "evaluation_bundle_invalid",
      "The evaluation bundle has an empty or duplicated active case selection.",
    );
  }
  const byId = new Map(
    availableCases.map((evaluationCase) => [evaluationCase.caseId, evaluationCase]),
  );
  if (byId.size !== availableCases.length || [...requested].some((caseId) => !byId.has(caseId))) {
    throw new SearchLocalError(
      "evaluation_bundle_invalid",
      "The evaluation bundle selected a missing or duplicated case.",
    );
  }
  return [...requested].sort().map((caseId) => byId.get(caseId)!);
}
