import { describe, expect, it } from "vitest";

import {
  assertSearchQueryProjectionReceipt,
  boundProjectedSearchQuery,
  createSearchQueryProjection,
  queryCoverageInterleave,
  reciprocalRankFusion,
  searchQueryProjectorBuildId,
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

describe("search query projection", () => {
  it("bounds provider text to the search-port character and term contract", () => {
    const bounded = boundProjectedSearchQuery(
      `prefix ${Array.from({ length: 40 }, (_, index) => `term${index}`).join(" ")}`,
    );

    expect(bounded.length).toBeLessThanOrEqual(500);
    expect(bounded.split(" ")).toHaveLength(32);
  });

  it("creates a content-bound privacy-safe receipt without query text", () => {
    const projection = createSearchQueryProjection({
      projector: {
        id: "semantic_grounding.codex",
        version: 1,
        buildId: searchQueryProjectorBuildId("semantic-grounding-query-projection-v1"),
      },
      requestDigest: digest("a"),
      contextDigest: digest("b"),
      projectorResultDigest: digest("c"),
      requestedLanguage: "en",
      queries: ["search engine activation gates", "external search adapter boundary"],
      durationMs: 42,
      status: "completed",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        reasoningOutputTokens: 0,
        totalTokens: 120,
        contextWindow: 200_000,
      },
    });

    expect(projection.receipt).toMatchObject({
      stageId: "query_projection",
      projectedQueryCount: 2,
      status: "completed",
      usage: { totalTokens: 120 },
      privacy: {
        requestText: "excluded",
        contextText: "excluded",
        projectedQueryText: "excluded",
      },
    });
    expect(JSON.stringify(projection.receipt)).not.toContain("activation gates");
    expect(() => assertSearchQueryProjectionReceipt(projection.receipt)).not.toThrow();
  });

  it("rejects output text on failed projection and receipt drift", () => {
    expect(() =>
      createSearchQueryProjection({
        projector: {
          id: "semantic_grounding.claude",
          version: 1,
          buildId: searchQueryProjectorBuildId("semantic-grounding-query-projection-v1"),
        },
        requestDigest: digest("a"),
        contextDigest: digest("b"),
        projectorResultDigest: digest("0"),
        requestedLanguage: "en",
        queries: ["unsafe retained query"],
        durationMs: 1,
        status: "failed",
      }),
    ).toThrow(/input is invalid/u);

    const valid = createSearchQueryProjection({
      projector: {
        id: "semantic_grounding.claude",
        version: 1,
        buildId: searchQueryProjectorBuildId("semantic-grounding-query-projection-v1"),
      },
      requestDigest: digest("a"),
      contextDigest: digest("b"),
      projectorResultDigest: digest("0"),
      requestedLanguage: "en",
      queries: [],
      durationMs: 1,
      status: "failed",
    });
    expect(() => assertSearchQueryProjectionReceipt({ ...valid.receipt, durationMs: 2 })).toThrow(
      /does not match/u,
    );
  });
});

describe("reciprocal rank fusion", () => {
  it("combines independent rankings deterministically without native scores", () => {
    const first = [
      { key: "doc_a", value: "a" },
      { key: "doc_b", value: "b" },
      { key: "doc_c", value: "c" },
    ];
    const second = [
      { key: "doc_b", value: "b" },
      { key: "doc_c", value: "c" },
      { key: "doc_d", value: "d" },
    ];

    const result = reciprocalRankFusion([first, second], 3);

    expect(result.values).toEqual(["b", "c", "a"]);
    expect(result).toMatchObject({
      algorithm: "reciprocal_rank_fusion",
      rankConstant: 60,
      inputCount: 2,
    });
    expect(reciprocalRankFusion([first, second], 3).resultDigest).toBe(result.resultDigest);
  });
});

describe("query coverage interleave", () => {
  it("preserves distinct high-ranked evidence from every projected query", () => {
    const result = queryCoverageInterleave(
      [
        [
          { key: "doc_shared", value: "shared" },
          { key: "doc_a", value: "a" },
        ],
        [
          { key: "doc_shared", value: "shared" },
          { key: "doc_b", value: "b" },
        ],
      ],
      3,
    );

    expect(result.values).toEqual(["shared", "a", "b"]);
    expect(result.algorithm).toBe("query_coverage_interleave");
  });
});
