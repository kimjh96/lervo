import {
  assertSearchEngineActivationEvidence,
  assertSearchEngineActivationOperator,
  candidateSearchEngineSelection,
  sameSearchEngineSelection,
  type SearchCandidateReview,
  type SearchEngineActivation,
  type SearchEngineActivationPolicy,
  type SearchEngineSelection,
  type SearchEvaluationComparison,
} from "@lervo/search";

import { loadSearchEngineActivationPolicies } from "./engine-policy-files.js";
import { loadStoredSearchEvaluationComparison } from "./evaluation-comparison-reader.js";
import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { SearchLocalError } from "./types.js";

interface ActivationEvidence {
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
}

async function loadActivationEvidence(
  repositoryRoot: string,
  selection: SearchEngineSelection,
): Promise<ActivationEvidence> {
  if (selection.mode !== "candidate" || selection.reviewId === null || selection.comparisonId === null) {
    throw new SearchLocalError("observation_invalid", "후보 검색 엔진 선택의 검토·비교 좌표가 없습니다.");
  }
  const [review, comparison] = await Promise.all([
    loadStoredSearchCandidateReview(repositoryRoot, selection.reviewId),
    loadStoredSearchEvaluationComparison(repositoryRoot, selection.comparisonId),
  ]);
  return { review, comparison };
}

export async function verifySearchEngineSelectionHistory(input: {
  repositoryRoot: string;
  projectId: string;
  history: readonly SearchEngineActivation[];
}): Promise<void> {
  const policies = await loadSearchEngineActivationPolicies(input.repositoryRoot);
  const policiesById = new Map(policies.map((policy) => [policy.policyId, policy]));
  let previous: SearchEngineActivation | null = null;
  for (const activation of input.history) {
    const policy: SearchEngineActivationPolicy | undefined = policiesById.get(activation.policyId);
    if (policy === undefined || policy.projectId !== input.projectId || activation.projectId !== input.projectId) {
      throw new SearchLocalError("engine_selection_unavailable", "검색 엔진 선택 정책이나 project 좌표가 없습니다.");
    }
    assertSearchEngineActivationOperator(policy, activation.operatorId);
    if (activation.action === "activate_candidate") {
      const evidence = await loadActivationEvidence(input.repositoryRoot, activation.selected);
      assertSearchEngineActivationEvidence({
        policy,
        review: evidence.review,
        comparison: evidence.comparison,
      });
      if (!sameSearchEngineSelection(activation.selected, candidateSearchEngineSelection(evidence.review))) {
        throw new SearchLocalError("observation_invalid", "검색 엔진 선택이 검토·비교 원본과 다릅니다.");
      }
    } else {
      if (previous === null) {
        throw new SearchLocalError("observation_invalid", "첫 검색 엔진 선택 전이는 rollback일 수 없습니다.");
      }
      const evidence = activation.selected.mode === "candidate"
        ? await loadActivationEvidence(input.repositoryRoot, activation.selected)
        : undefined;
      if (evidence !== undefined) {
        assertSearchEngineActivationEvidence({
          policy,
          review: evidence.review,
          comparison: evidence.comparison,
        });
        if (!sameSearchEngineSelection(activation.selected, candidateSearchEngineSelection(evidence.review))) {
          throw new SearchLocalError("observation_invalid", "Rollback 선택이 검토·비교 원본과 다릅니다.");
        }
      }
    }
    previous = activation;
  }
}
