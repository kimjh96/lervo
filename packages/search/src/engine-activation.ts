import {
  assertSearchEngineActivationEvidence,
  assertSearchEngineActivationOperator,
} from "./engine-activation-eligibility.js";
import type {
  SearchEngineActivation,
  SearchEngineActivationPolicy,
  SearchEngineCandidateActivation,
  SearchEngineCandidateRefresh,
  SearchEngineRollback,
  SearchEngineRolloutActionEvidence,
  SearchEngineRolloutRollback,
} from "./engine-activation-types.js";
import { assertSearchEngineActivation } from "./engine-activation-validation.js";
import {
  baselineSearchEngineSelection,
  candidateSearchEngineSelection,
  sameSearchEngineSelection,
} from "./engine-selection.js";
import type { SearchEvaluationComparison } from "./evaluation-comparison-types.js";
import type { SearchCandidateReview } from "./evaluation-review-types.js";
import { contentId } from "./integrity.js";
import { sameSearchEngine } from "./evaluation-engine.js";
import { SearchError } from "./types.js";

function createTransition<
  T extends SearchEngineCandidateActivation | SearchEngineCandidateRefresh | SearchEngineRollback,
>(core: Omit<T, "schemaVersion" | "activationId">): T {
  const activation = {
    schemaVersion: 2,
    activationId: contentId("seact", core),
    ...core,
  } as T;
  assertSearchEngineActivation(activation);
  return activation;
}

function createRolloutRollbackTransition(
  core: Omit<SearchEngineRolloutRollback, "schemaVersion" | "activationId">,
): SearchEngineRolloutRollback {
  const activation: SearchEngineRolloutRollback = {
    schemaVersion: 3,
    activationId: contentId("seact", core),
    ...core,
  };
  assertSearchEngineActivation(activation);
  return activation;
}

export function searchEngineActivationFallback(activation: SearchEngineActivation): {
  selection: SearchEngineActivation["selected"];
  activationId: string | null;
} {
  return activation.schemaVersion !== 1
    ? { selection: activation.fallbackSelection, activationId: activation.fallbackActivationId }
    : { selection: activation.previousSelection, activationId: activation.previousActivationId };
}

export function createSearchEngineCandidateActivation(input: {
  policy: SearchEngineActivationPolicy;
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
  previous: SearchEngineActivation | null;
  operatorId: string;
  decidedAt: Date;
}): SearchEngineCandidateActivation {
  assertSearchEngineActivationOperator(input.policy, input.operatorId);
  assertSearchEngineActivationEvidence(input);
  if (input.review.schemaVersion !== 2 || input.comparison.schemaVersion !== 2) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "A new search engine selection requires a review bound to an adapter build.",
    );
  }
  if (!Number.isFinite(input.decidedAt.getTime())) {
    throw new SearchError(
      "invalid_engine_activation",
      "The search engine activation timestamp is invalid.",
    );
  }
  if (input.previous !== null) {
    assertSearchEngineActivation(input.previous);
    if (input.previous.projectId !== input.policy.projectId) {
      throw new SearchError(
        "invalid_engine_activation",
        "The project in the previous search engine selection differs from the policy.",
      );
    }
  }
  const previousSelection = input.previous?.selected ?? baselineSearchEngineSelection();
  const selected = candidateSearchEngineSelection(input.review);
  if (
    previousSelection.mode === "candidate" &&
    previousSelection.candidateId === selected.candidateId &&
    sameSearchEngine(previousSelection.engine, selected.engine)
  ) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "New evidence for the same candidate engine must be recorded as a refresh.",
    );
  }
  if (sameSearchEngineSelection(previousSelection, selected)) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "The currently selected search engine cannot be activated again.",
    );
  }
  return createTransition({
    projectId: input.policy.projectId,
    sequence: (input.previous?.sequence ?? 0) + 1,
    previousActivationId: input.previous?.activationId ?? null,
    action: "activate_candidate",
    policyId: input.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    previousSelection: structuredClone(previousSelection),
    selected,
    rollbackOfActivationId: null,
    fallbackSelection: structuredClone(previousSelection),
    fallbackActivationId: input.previous?.activationId ?? null,
    recordState: "selection_recorded",
    embeddingDecision: "not_determined",
  });
}

export function createSearchEngineCandidateRefresh(input: {
  policy: SearchEngineActivationPolicy;
  review: SearchCandidateReview;
  comparison: SearchEvaluationComparison;
  previous: SearchEngineActivation;
  operatorId: string;
  decidedAt: Date;
}): SearchEngineCandidateRefresh {
  assertSearchEngineActivationOperator(input.policy, input.operatorId);
  assertSearchEngineActivationEvidence(input);
  if (input.review.schemaVersion !== 2 || input.comparison.schemaVersion !== 2) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "A candidate search refresh requires a review bound to an adapter build.",
    );
  }
  assertSearchEngineActivation(input.previous);
  if (
    input.previous.projectId !== input.policy.projectId ||
    !Number.isFinite(input.decidedAt.getTime())
  ) {
    throw new SearchError(
      "invalid_engine_activation",
      "The search engine refresh coordinates are invalid.",
    );
  }
  const previousSelection = input.previous.selected;
  const selected = candidateSearchEngineSelection(input.review);
  if (
    previousSelection.mode !== "candidate" ||
    previousSelection.candidateId !== selected.candidateId ||
    !sameSearchEngine(previousSelection.engine, selected.engine)
  ) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "A refresh requires new evidence for the currently selected candidate engine.",
    );
  }
  if (sameSearchEngineSelection(previousSelection, selected)) {
    throw new SearchError(
      "engine_activation_not_eligible",
      "The same review and comparison sources as the current selection cannot be refreshed.",
    );
  }
  return createTransition<SearchEngineCandidateRefresh>({
    projectId: input.policy.projectId,
    sequence: input.previous.sequence + 1,
    previousActivationId: input.previous.activationId,
    action: "refresh_candidate",
    policyId: input.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    previousSelection: structuredClone(previousSelection),
    selected,
    rollbackOfActivationId: null,
    fallbackSelection: baselineSearchEngineSelection(),
    fallbackActivationId: null,
    recordState: "selection_recorded",
    embeddingDecision: "not_determined",
  });
}

interface CreateSearchEngineRollbackInput {
  policy: SearchEngineActivationPolicy;
  previous: SearchEngineActivation;
  targetReview?: SearchCandidateReview;
  targetComparison?: SearchEvaluationComparison;
  operatorId: string;
  decidedAt: Date;
}

export function createSearchEngineRollback(
  input: CreateSearchEngineRollbackInput & { rolloutAction: SearchEngineRolloutActionEvidence },
): SearchEngineRolloutRollback;
export function createSearchEngineRollback(
  input: CreateSearchEngineRollbackInput,
): SearchEngineRollback;
export function createSearchEngineRollback(
  input: CreateSearchEngineRollbackInput & {
    rolloutAction?: SearchEngineRolloutActionEvidence | undefined;
  },
): SearchEngineRollback | SearchEngineRolloutRollback {
  assertSearchEngineActivationOperator(input.policy, input.operatorId);
  assertSearchEngineActivation(input.previous);
  if (
    input.previous.projectId !== input.policy.projectId ||
    !Number.isFinite(input.decidedAt.getTime())
  ) {
    throw new SearchError(
      "invalid_engine_activation",
      "The search engine rollback coordinates are invalid.",
    );
  }
  const fallback = searchEngineActivationFallback(input.previous);
  const selected = fallback.selection;
  if (selected.mode === "candidate") {
    if (input.targetReview === undefined || input.targetComparison === undefined) {
      throw new SearchError(
        "engine_activation_not_eligible",
        "Returning to a previous candidate requires its original review and comparison sources.",
      );
    }
    assertSearchEngineActivationEvidence({
      policy: input.policy,
      review: input.targetReview,
      comparison: input.targetComparison,
    });
    if (!sameSearchEngineSelection(selected, candidateSearchEngineSelection(input.targetReview))) {
      throw new SearchError(
        "engine_activation_not_eligible",
        "The rollback target differs from the previous search engine selection.",
      );
    }
  } else if (input.targetReview !== undefined || input.targetComparison !== undefined) {
    throw new SearchError(
      "invalid_engine_activation",
      "A baseline rollback does not use candidate review sources.",
    );
  }
  const core: Omit<SearchEngineRollback, "schemaVersion" | "activationId"> = {
    projectId: input.policy.projectId,
    sequence: input.previous.sequence + 1,
    previousActivationId: input.previous.activationId,
    action: "rollback",
    policyId: input.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    previousSelection: structuredClone(input.previous.selected),
    selected: structuredClone(selected),
    rollbackOfActivationId: input.previous.activationId,
    fallbackSelection: structuredClone(input.previous.selected),
    fallbackActivationId: input.previous.activationId,
    recordState: "selection_recorded",
    embeddingDecision: "not_determined",
  };
  return input.rolloutAction === undefined
    ? createTransition<SearchEngineRollback>(core)
    : createRolloutRollbackTransition({
        ...core,
        rolloutAction: structuredClone(input.rolloutAction),
      });
}
