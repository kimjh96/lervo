import { describe, expect, it } from "vitest";

import { productDefaultRepositoryKnowledgeRanker } from "../src/index.js";

describe("product-default repository knowledge ranker", () => {
  it("uses the qualified lexical-v2 adapter for fuzzy knowledge retrieval", () => {
    const ranker = productDefaultRepositoryKnowledgeRanker.prepare([
      {
        conceptId: "concept_replica",
        title: "Repository replica readiness",
        path: "docs/replica-readiness.md",
        contentHash: `sha256:${"a".repeat(64)}`,
        labels: ["current"],
        text: "Exact replica reconciliation contract.",
      },
      {
        conceptId: "concept_unrelated",
        title: "Writing policy",
        path: "docs/writing.md",
        contentHash: `sha256:${"b".repeat(64)}`,
        labels: ["current"],
        text: "Human publication language.",
      },
    ]);
    expect(ranker).not.toBeInstanceOf(Promise);
    const prepared = ranker as Exclude<typeof ranker, Promise<unknown>>;
    expect(prepared.rank({ query: "repositry readiness", limit: 5 })).toEqual([
      expect.objectContaining({ conceptId: "concept_replica" }),
    ]);
    expect(prepared.engine).toEqual({ id: "lexical", version: 2 });
  });
});
