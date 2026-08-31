import { assertSearchAdapterBuildId, assertSearchEngineIdentity } from "./evaluation-engine.js";
import { SEARCH_CANDIDATE_ID_PATTERN } from "./evaluation-engine-registry.js";
import { assertSearchRetrievalPlan } from "./retrieval-plan-definition.js";
import type { SearchRetrievalPlan } from "./retrieval-plan-types.js";
import type { SearchEngineIdentity } from "./types.js";

const QUALIFICATION_ID_PATTERN = /^spqual_[a-f0-9]{24}$/u;

export interface ProductDefaultSearchEngine {
  qualificationId: string;
  candidateId: string;
  engine: SearchEngineIdentity;
  adapterBuildId: string;
}

export interface ProductDefaultSearchRetrievalPlan {
  qualificationId: string;
  plan: SearchRetrievalPlan;
}

export interface ProductDefaultSearchEngineSelection {
  mode: "product_default";
  qualificationId: string;
  candidateId: string;
  engine: SearchEngineIdentity;
  reviewId: null;
  comparisonId: null;
}

export interface ProductDefaultSearchRetrievalPlanSelection {
  mode: "product_default";
  qualificationId: string;
  planId: string;
  reviewId: null;
  bundleId: null;
}

export function assertProductDefaultSearchEngine(value: ProductDefaultSearchEngine): void {
  assertSearchEngineIdentity(value.engine);
  assertSearchAdapterBuildId(value.adapterBuildId);
  if (
    !QUALIFICATION_ID_PATTERN.test(value.qualificationId) ||
    !SEARCH_CANDIDATE_ID_PATTERN.test(value.candidateId)
  ) {
    throw new TypeError("The product-default search engine qualification is invalid.");
  }
}

export function assertProductDefaultSearchRetrievalPlan(
  value: ProductDefaultSearchRetrievalPlan,
): void {
  assertSearchRetrievalPlan(value.plan);
  if (!QUALIFICATION_ID_PATTERN.test(value.qualificationId)) {
    throw new TypeError("The product-default retrieval-plan qualification is invalid.");
  }
}
