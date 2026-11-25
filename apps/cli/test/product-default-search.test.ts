import { describe, expect, it } from "vitest";

import {
  PRODUCT_DEFAULT_SEARCH_QUALIFICATION_ID,
  productDefaultSearchEngine,
  productDefaultSearchRetrievalPlan,
} from "../src/product-default-search.js";
import { productionSearchQueryProjectorIdentity } from "@lervo/repository-context";

describe("product-default search", () => {
  it("binds the qualified Lexical v2 engine and complete provider-neutral plan", () => {
    expect(productDefaultSearchEngine).toEqual({
      qualificationId: PRODUCT_DEFAULT_SEARCH_QUALIFICATION_ID,
      candidateId: "lexical-v2",
      engine: { id: "lexical", version: 2 },
      adapterBuildId: "sebuild_e9f2ac9398b0f58d03143e7a",
    });
    expect(productDefaultSearchRetrievalPlan).toMatchObject({
      qualificationId: PRODUCT_DEFAULT_SEARCH_QUALIFICATION_ID,
      supersededPlanIds: ["srplan_db810188acfc08abd0b5bd4a"],
      plan: {
        planId: "srplan_317d592259ccbf6029f534f5",
        retrieval: {
          candidateId: "lexical-v2",
          engine: { id: "lexical", version: 2 },
          adapterBuildId: "sebuild_e9f2ac9398b0f58d03143e7a",
        },
        fusion: { algorithm: "query_coverage_interleave", version: 1 },
      },
    });
  });

  it("binds the current production projector builds for both providers", () => {
    expect(productionSearchQueryProjectorIdentity("codex").buildId).toBe(
      "sqbuild_4567982e194ed62053cdcb25",
    );
    expect(productionSearchQueryProjectorIdentity("claude").buildId).toBe(
      "sqbuild_76f588303e15c0916982d03e",
    );
  });
});
