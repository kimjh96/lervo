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
  type SearchAssessment,
  type SearchAttempt,
} from "@lervo/search";

import { loadSearchEngineActivationPolicies } from "./engine-policy-files.js";
import { loadStoredSearchEvaluationComparison } from "./evaluation-comparison-reader.js";
import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { verifySearchRolloutRollbackEvidence } from "./rollout-action-evidence.js";
import { LocalSearchObservationStore } from "./store.js";
import { SearchLocalError } from "./types.js";

interface ActivationEvidence {
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
}

async function loadActivationEvidence(
  repositoryRoot: string,
  selection: SearchEngineSelection,
): Promise<ActivationEvidence> {
  if (
    selection.mode !== "candidate" ||
    selection.reviewId === null ||
    selection.comparisonId === null
  ) {
    throw new SearchLocalError(
      "observation_invalid",
      "The candidate search engine selection has no review or comparison coordinates.",
    );
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
  attempts?: readonly SearchAttempt[];
  assessments?: readonly SearchAssessment[];
}): Promise<void> {
  const policies = await loadSearchEngineActivationPolicies(input.repositoryRoot);
  const policiesById = new Map(policies.map((policy) => [policy.policyId, policy]));
  let attempts = input.attempts;
  let assessments = input.assessments;
  if (
    input.history.some((activation) => activation.schemaVersion === 3) &&
    (attempts === undefined || assessments === undefined)
  ) {
    const store = await LocalSearchObservationStore.openExisting(input.repositoryRoot);
    [attempts, assessments] =
      store === null
        ? [[], []]
        : await Promise.all([store.listAttempts(), store.listAssessments()]);
  }
  let previous: SearchEngineActivation | null = null;
  for (const activation of input.history) {
    const policy: SearchEngineActivationPolicy | undefined = policiesById.get(activation.policyId);
    if (
      policy === undefined ||
      policy.projectId !== input.projectId ||
      activation.projectId !== input.projectId
    ) {
      throw new SearchLocalError(
        "engine_selection_unavailable",
        "The search engine selection has no policy or project coordinates.",
      );
    }
    assertSearchEngineActivationOperator(policy, activation.operatorId);
    if (activation.action === "activate_candidate" || activation.action === "refresh_candidate") {
      const evidence = await loadActivationEvidence(input.repositoryRoot, activation.selected);
      assertSearchEngineActivationEvidence({
        policy,
        review: evidence.review,
        comparison: evidence.comparison,
      });
      if (
        !sameSearchEngineSelection(
          activation.selected,
          candidateSearchEngineSelection(evidence.review),
        )
      ) {
        throw new SearchLocalError(
          "observation_invalid",
          "The search engine selection differs from the review and comparison sources.",
        );
      }
    } else {
      if (previous === null) {
        throw new SearchLocalError(
          "observation_invalid",
          "The first search engine selection transition cannot be a rollback.",
        );
      }
      const evidence =
        activation.selected.mode === "candidate"
          ? await loadActivationEvidence(input.repositoryRoot, activation.selected)
          : undefined;
      if (evidence !== undefined) {
        assertSearchEngineActivationEvidence({
          policy,
          review: evidence.review,
          comparison: evidence.comparison,
        });
        if (
          !sameSearchEngineSelection(
            activation.selected,
            candidateSearchEngineSelection(evidence.review),
          )
        ) {
          throw new SearchLocalError(
            "observation_invalid",
            "The rollback selection differs from the review and comparison sources.",
          );
        }
      }
      if (activation.schemaVersion === 3) {
        await verifySearchRolloutRollbackEvidence({
          repositoryRoot: input.repositoryRoot,
          projectId: input.projectId,
          activation,
          previous,
          attempts: attempts!,
          assessments: assessments!,
        });
      }
    }
    previous = activation;
  }
}
