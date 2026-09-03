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

const qualifiedProjectors = (["codex", "claude"] as const).map((provider) => ({
  provider,
  projector: productionSearchQueryProjectorIdentity(provider),
}));
const supersededPlanIds = ["srplan_db810188acfc08abd0b5bd4a"] as const;

const qualification = {
  decisionIds: ["adr-0328-product-default-lexical-v2", "adr-0353-direct-query-projection"],
  engineEvidenceHash: "sha256:e9408bc445900f9cc09677d9684e610e31a1e987765eec2d58371fe41d1a0b30",
  projectorEvidenceHash: "sha256:ddaed652bcdffaa24dbe5e86733c4d744b6c3b84fe6f5bdef4c11664627e48a9",
  candidateId: "lexical-v2",
  engine: LEXICAL_V2_SEARCH_ENGINE,
  adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
  projectors: qualifiedProjectors.map(({ projector }) => projector),
  supersededPlanIds,
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
    populations: qualifiedProjectors.map(({ provider, projector }) => ({
      populationId: `provider.${provider}`,
      projector,
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
  supersededPlanIds: [...supersededPlanIds],
};
