import {
  contentId,
  createSearchRetrievalPlan,
  type ProductDefaultSearchEngine,
  type ProductDefaultSearchRetrievalPlan,
} from "@lervo/search";
import {
  LEXICAL_V2_ADAPTER_BUILD_ID,
  LEXICAL_V2_SEARCH_ENGINE,
} from "@lervo/search-adapter-lexical-v2";

import { productionSearchQueryProjectorIdentity } from "./provider-query-projector.js";

const qualification = {
  decisionId: "adr-0328-product-default-lexical-v2",
  evidenceHash: "sha256:e9408bc445900f9cc09677d9684e610e31a1e987765eec2d58371fe41d1a0b30",
  candidateId: "lexical-v2",
  engine: LEXICAL_V2_SEARCH_ENGINE,
  adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
} as const;

export const PRODUCT_DEFAULT_SEARCH_QUALIFICATION_ID = contentId("spqual", qualification);

export const productDefaultSearchEngine: ProductDefaultSearchEngine = {
  qualificationId: PRODUCT_DEFAULT_SEARCH_QUALIFICATION_ID,
  candidateId: qualification.candidateId,
  engine: qualification.engine,
  adapterBuildId: qualification.adapterBuildId,
};

const plan = createSearchRetrievalPlan({
  projection: {
    required: true,
    populations: (["codex", "claude"] as const).map((provider) => ({
      populationId: `provider.${provider}`,
      projector: productionSearchQueryProjectorIdentity(provider),
    })),
    maximumQueries: 8,
    maximumQueryCharacters: 500,
  },
  retrieval: {
    stageId: "primary_retrieval",
    candidateId: qualification.candidateId,
    engine: qualification.engine,
    adapterBuildId: qualification.adapterBuildId,
    perQueryLimit: 50,
  },
  fusion: { algorithm: "query_coverage_interleave", version: 1 },
  finalLimit: 10,
  failurePolicy: "fail_closed",
  privacy: {
    requestText: "excluded",
    contextText: "excluded",
    projectedQueryText: "excluded",
    credentials: "excluded",
  },
});

export const productDefaultSearchRetrievalPlan: ProductDefaultSearchRetrievalPlan = {
  qualificationId: PRODUCT_DEFAULT_SEARCH_QUALIFICATION_ID,
  plan,
};
