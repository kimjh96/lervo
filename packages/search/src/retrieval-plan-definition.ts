import { contentId } from "./integrity.js";
import { assertSearchAdapterBuildId, assertSearchEngineIdentity } from "./evaluation-engine.js";
import {
  SEARCH_QUERY_PROJECTOR_BUILD_ID_PATTERN,
  SEARCH_QUERY_PROJECTOR_ID_PATTERN,
} from "./query-projection.js";
import {
  invalidRetrievalPlan,
  PLAN_ID_PATTERN,
  POPULATION_ID_PATTERN,
} from "./retrieval-plan-common.js";
import type { SearchRetrievalPlan } from "./retrieval-plan-types.js";

function planCore(plan: SearchRetrievalPlan): Omit<SearchRetrievalPlan, "planId"> {
  const { planId: _planId, ...core } = plan;
  return core;
}

export function createSearchRetrievalPlan(
  input: Omit<SearchRetrievalPlan, "schemaVersion" | "planId">,
): SearchRetrievalPlan {
  const core = { schemaVersion: 1 as const, ...structuredClone(input) };
  const plan = { ...core, planId: contentId("srplan", core) };
  assertSearchRetrievalPlan(plan);
  return plan;
}

export function assertSearchRetrievalPlan(plan: SearchRetrievalPlan): void {
  if (
    plan.schemaVersion !== 1 ||
    !PLAN_ID_PATTERN.test(plan.planId) ||
    plan.projection.required !== true ||
    plan.projection.populations.length < 2 ||
    plan.projection.populations.length > 8 ||
    new Set(plan.projection.populations.map((item) => item.populationId)).size !==
      plan.projection.populations.length ||
    plan.projection.populations.some(
      ({ populationId, projector }) =>
        !POPULATION_ID_PATTERN.test(populationId) ||
        !SEARCH_QUERY_PROJECTOR_ID_PATTERN.test(projector.id) ||
        !Number.isSafeInteger(projector.version) ||
        projector.version < 1 ||
        !SEARCH_QUERY_PROJECTOR_BUILD_ID_PATTERN.test(projector.buildId),
    ) ||
    !Number.isSafeInteger(plan.projection.maximumQueries) ||
    plan.projection.maximumQueries < 1 ||
    plan.projection.maximumQueries > 8 ||
    !Number.isSafeInteger(plan.projection.maximumQueryCharacters) ||
    plan.projection.maximumQueryCharacters < 1 ||
    plan.projection.maximumQueryCharacters > 500 ||
    plan.retrieval.stageId !== "primary_retrieval" ||
    !POPULATION_ID_PATTERN.test(plan.retrieval.candidateId) ||
    !Number.isSafeInteger(plan.retrieval.perQueryLimit) ||
    plan.retrieval.perQueryLimit < 1 ||
    plan.retrieval.perQueryLimit > 50 ||
    !Number.isSafeInteger(plan.finalLimit) ||
    plan.finalLimit < 1 ||
    plan.finalLimit > 50 ||
    plan.fusion.version !== 1 ||
    !new Set(["query_coverage_interleave", "reciprocal_rank_fusion"]).has(plan.fusion.algorithm) ||
    plan.failurePolicy !== "fail_closed" ||
    Object.values(plan.privacy).some((value) => value !== "excluded")
  ) {
    invalidRetrievalPlan("The retrieval-plan contract is invalid.");
  }
  assertSearchEngineIdentity(plan.retrieval.engine, "invalid_retrieval_plan");
  assertSearchAdapterBuildId(plan.retrieval.adapterBuildId, "invalid_retrieval_plan");
  if (contentId("srplan", planCore(plan)) !== plan.planId)
    invalidRetrievalPlan("The retrieval-plan ID does not match its content.");
}
