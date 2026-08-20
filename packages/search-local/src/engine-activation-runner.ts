import {
  createSearchEngineCandidateActivation,
  createSearchEngineRollback,
  type SearchEngineActivation,
  type SearchEvaluationEngineRegistry,
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
  registry: SearchEvaluationEngineRegistry;
}): Promise<SearchEngineActivation> {
  const policy = await loadSearchEngineActivationPolicy(input.repositoryRoot, input.policyId);
  if (policy.projectId !== input.projectId) {
    throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책의 project 좌표가 다릅니다.");
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

export async function rollbackLocalSearchCandidate(input: {
  repositoryRoot: string;
  projectId: string;
  policyId: string;
  operatorId: string;
  decidedAt: Date;
  registry: SearchEvaluationEngineRegistry;
}): Promise<SearchEngineActivation> {
  const [policy, previous] = await Promise.all([
    loadSearchEngineActivationPolicy(input.repositoryRoot, input.policyId),
    loadCurrentSearchEngineActivation(input.repositoryRoot),
  ]);
  if (policy.projectId !== input.projectId) {
    throw new SearchLocalError("engine_policy_invalid", "검색 엔진 활성화 정책의 project 좌표가 다릅니다.");
  }
  if (previous === null || previous.projectId !== input.projectId) {
    throw new SearchLocalError("engine_activation_not_found", "되돌릴 검색 엔진 선택이 없습니다.");
  }
  const targetEvidence = previous.previousSelection.mode === "candidate"
    ? await verifySearchCandidateActivationEvidence({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      reviewId: previous.previousSelection.reviewId!,
      registry: input.registry,
    })
    : undefined;
  const activation = createSearchEngineRollback({
    policy,
    previous,
    ...(targetEvidence === undefined
      ? {}
      : { targetReview: targetEvidence.review, targetComparison: targetEvidence.comparison }),
    operatorId: input.operatorId,
    decidedAt: input.decidedAt,
  });
  await recordSearchEngineActivation(input.repositoryRoot, activation);
  return activation;
}
