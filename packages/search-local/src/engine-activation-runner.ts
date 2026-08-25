import {
  createSearchEngineCandidateActivation,
  createSearchEngineCandidateRefresh,
  createSearchEngineRollback,
  searchEngineActivationFallback,
  type SearchCandidateEngineResolver,
  type SearchEngineActivation,
  type SearchEngineRolloutActionEvidence,
} from "@lervo/search";

import {
  loadCurrentSearchEngineActivation,
  recordSearchEngineActivation,
} from "./engine-activation-store.js";
import { verifySearchCandidateActivationEvidence } from "./engine-activation-evidence.js";
import { loadSearchEngineActivationPolicy } from "./engine-policy-files.js";
import { SearchLocalError } from "./types.js";

export async function activateLocalSearchCandidate(input: {
  repositoryRoot: string;
  projectId: string;
  reviewId: string;
  policyId: string;
  operatorId: string;
  decidedAt: Date;
  registry: SearchCandidateEngineResolver;
}): Promise<SearchEngineActivation> {
  const policy = await loadSearchEngineActivationPolicy(input.repositoryRoot, input.policyId);
  if (policy.projectId !== input.projectId) {
    throw new SearchLocalError(
      "engine_policy_invalid",
      "The search engine activation policy has different project coordinates.",
    );
  }
  const evidence = await verifySearchCandidateActivationEvidence({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    reviewId: input.reviewId,
    registry: input.registry,
  });
  const previous = await loadCurrentSearchEngineActivation(input.repositoryRoot);
  const activation = createSearchEngineCandidateActivation({
    policy,
    review: evidence.review,
    comparison: evidence.comparison,
    previous,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt,
  });
  await recordSearchEngineActivation(input.repositoryRoot, activation);
  return activation;
}

export async function refreshLocalSearchCandidate(input: {
  repositoryRoot: string;
  projectId: string;
  reviewId: string;
  policyId: string;
  operatorId: string;
  decidedAt: Date;
  registry: SearchCandidateEngineResolver;
}): Promise<SearchEngineActivation> {
  const [policy, previous] = await Promise.all([
    loadSearchEngineActivationPolicy(input.repositoryRoot, input.policyId),
    loadCurrentSearchEngineActivation(input.repositoryRoot),
  ]);
  if (policy.projectId !== input.projectId) {
    throw new SearchLocalError(
      "engine_policy_invalid",
      "The search engine refresh policy has different project coordinates.",
    );
  }
  if (
    previous === null ||
    previous.projectId !== input.projectId ||
    previous.selected.mode !== "candidate"
  ) {
    throw new SearchLocalError(
      "engine_activation_not_found",
      "There is no current candidate search engine selection to refresh.",
    );
  }
  const evidence = await verifySearchCandidateActivationEvidence({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    reviewId: input.reviewId,
    registry: input.registry,
  });
  const refresh = createSearchEngineCandidateRefresh({
    policy,
    review: evidence.review,
    comparison: evidence.comparison,
    previous,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt,
  });
  await recordSearchEngineActivation(input.repositoryRoot, refresh);
  return refresh;
}

async function prepareLocalSearchCandidateRollback(input: {
  repositoryRoot: string;
  projectId: string;
  policyId: string;
  operatorId: string;
  decidedAt: Date;
  registry: SearchCandidateEngineResolver;
  expectedPreviousActivationId?: string;
  rolloutAction?: SearchEngineRolloutActionEvidence;
}): Promise<SearchEngineActivation> {
  const [policy, previous] = await Promise.all([
    loadSearchEngineActivationPolicy(input.repositoryRoot, input.policyId),
    loadCurrentSearchEngineActivation(input.repositoryRoot),
  ]);
  if (policy.projectId !== input.projectId) {
    throw new SearchLocalError(
      "engine_policy_invalid",
      "The search engine activation policy has different project coordinates.",
    );
  }
  if (previous === null || previous.projectId !== input.projectId) {
    throw new SearchLocalError(
      "engine_activation_not_found",
      "There is no search engine selection to roll back.",
    );
  }
  if (
    input.expectedPreviousActivationId !== undefined &&
    previous.activationId !== input.expectedPreviousActivationId
  ) {
    throw new SearchLocalError(
      "rollout_action_not_eligible",
      "The reviewed search candidate is no longer the current selection.",
    );
  }
  const rollbackTarget = searchEngineActivationFallback(previous).selection;
  const targetEvidence =
    rollbackTarget.mode === "candidate"
      ? await verifySearchCandidateActivationEvidence({
          repositoryRoot: input.repositoryRoot,
          projectId: input.projectId,
          reviewId: rollbackTarget.reviewId,
          registry: input.registry,
        })
      : undefined;
  return createSearchEngineRollback({
    policy,
    previous,
    ...(targetEvidence === undefined
      ? {}
      : { targetReview: targetEvidence.review, targetComparison: targetEvidence.comparison }),
    operatorId: input.operatorId,
    decidedAt: input.decidedAt,
    ...(input.rolloutAction === undefined ? {} : { rolloutAction: input.rolloutAction }),
  });
}

export async function verifyLocalSearchCandidateRollbackReadiness(
  input: Parameters<typeof prepareLocalSearchCandidateRollback>[0],
): Promise<void> {
  await prepareLocalSearchCandidateRollback(input);
}

export async function rollbackLocalSearchCandidate(
  input: Parameters<typeof prepareLocalSearchCandidateRollback>[0],
): Promise<SearchEngineActivation> {
  const activation = await prepareLocalSearchCandidateRollback(input);
  await recordSearchEngineActivation(input.repositoryRoot, activation);
  return activation;
}
