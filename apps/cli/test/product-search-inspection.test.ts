import { LEXICAL_V2_ADAPTER_BUILD_ID } from "@lervo/search-adapter-lexical-v2";
import { describe, expect, it } from "vitest";

import { inspectProductSearch } from "../src/product-search-inspection.js";

const revision = `sha256:${"a".repeat(64)}`;

function knowledgeResult() {
  return {
    schemaVersion: 1 as const,
    query: "activity evidence",
    semantics: "recommended" as const,
    ranking: {
      engine: { id: "lexical", version: 2 },
      adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
    },
    sourceSnapshotId: "ksnap_0123456789abcdef01234567",
    impactReportId: "kimpact_0123456789abcdef012345",
    hits: [
      {
        conceptId: "concept_0123456789abcdef012345",
        title: "Activity evidence",
        path: "docs/activity.md",
        ownership: "user" as const,
        score: 42,
        matchedTerms: ["activity"],
        assurance: "human_reviewed" as const,
        freshness: "current" as const,
        contentHash: `sha256:${"b".repeat(64)}`,
      },
    ],
    relationProjection: {
      schemaVersion: 1 as const,
      projectionId: "krelproj_0123456789abcdef012345",
      sourceSnapshotId: "ksnap_0123456789abcdef01234567",
      impactReportId: "kimpact_0123456789abcdef012345",
      conceptSidecarSetHash: `sha256:${"c".repeat(64)}`,
      relationSidecarSetHash: `sha256:${"d".repeat(64)}`,
      seedConceptIds: [],
      limits: {
        maximumSeeds: 5 as const,
        maximumExaminedRelations: 64 as const,
        maximumRecommendations: 5 as const,
        maximumSelections: 2 as const,
        hops: 1 as const,
      },
      examinedRelationCount: 0,
      truncated: false,
      recommendations: [],
    },
  };
}

describe("product search inspection", () => {
  it("projects qualified Lexical v2 knowledge at one stable repository revision", async () => {
    let captureCount = 0;
    const result = await inspectProductSearch(
      {
        repositoryRoot: "/repository",
        query: "activity evidence",
        corpusClass: "repository_knowledge",
        limit: 10,
      },
      {
        captureSnapshot: async () => {
          captureCount += 1;
          return { revision };
        },
        queryKnowledge: async (input) => {
          expect(input).toEqual({
            repositoryRoot: "/repository",
            query: "activity evidence",
            limit: 10,
          });
          return knowledgeResult();
        },
      },
    );

    expect(captureCount).toBe(2);
    expect(result).toMatchObject({
      repositoryRevision: revision,
      status: "complete",
      searchPlan: { engineId: "lexical", engineVersion: 2 },
      groups: [{ hits: [{ label: "Activity evidence" }] }],
    });
  });

  it("fails closed when repository bytes change during the query", async () => {
    let captureCount = 0;
    await expect(
      inspectProductSearch(
        {
          repositoryRoot: "/repository",
          query: "activity evidence",
          corpusClass: "repository_knowledge",
          limit: 10,
        },
        {
          captureSnapshot: async () => ({
            revision: `sha256:${(captureCount++ === 0 ? "a" : "f").repeat(64)}`,
          }),
          queryKnowledge: async () => knowledgeResult(),
        },
      ),
    ).rejects.toThrowError("changed during product search");
  });

  it("fails closed when the observed ranker is not the qualified Lexical v2 build", async () => {
    const wrong = knowledgeResult();
    wrong.ranking.adapterBuildId = "sebuild_changed";
    await expect(
      inspectProductSearch(
        {
          repositoryRoot: "/repository",
          query: "activity evidence",
          corpusClass: "repository_knowledge",
          limit: 10,
        },
        {
          captureSnapshot: async () => ({ revision }),
          queryKnowledge: async () => wrong,
        },
      ),
    ).rejects.toThrowError("qualified Lexical v2");
  });
});
