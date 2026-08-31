import { describe, expect, it } from "vitest";

import {
  createSearchQueryProjection,
  executeProjectedSearch,
  LexicalSearchIndex,
  searchQueryProjectorBuildId,
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

describe("projected search execution", () => {
  it("searches projections independently and returns privacy-bounded fusion evidence", async () => {
    const index = new LexicalSearchIndex([
      {
        kind: "document",
        sourceId: "doc_alpha",
        contentHash: digest("1"),
        labels: ["alpha"],
        text: "alpha shared",
      },
      {
        kind: "document",
        sourceId: "doc_beta",
        contentHash: digest("2"),
        labels: ["beta"],
        text: "beta shared",
      },
      {
        kind: "document",
        sourceId: "doc_shared",
        contentHash: digest("3"),
        labels: ["shared"],
        text: "alpha beta shared",
      },
    ]);
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
      queries: ["alpha", "beta"],
      durationMs: 12,
      status: "completed",
    });

    const result = await executeProjectedSearch({ projection, index, finalLimit: 3 });

    expect(result.hits[0]).toMatchObject({
      source: { sourceId: "doc_shared" },
      matchedQueryCount: 2,
    });
    expect(result).toMatchObject({
      projectionReceiptId: projection.receipt.receiptId,
      queryCount: 2,
      fusion: { algorithm: "reciprocal_rank_fusion", rankConstant: 60 },
    });
    expect(JSON.stringify(result)).not.toContain("alpha beta");
  });

  it("can preserve distinct query roles with deterministic coverage interleave", async () => {
    const index = new LexicalSearchIndex([
      {
        kind: "document",
        sourceId: "doc_alpha",
        contentHash: digest("1"),
        labels: ["alpha"],
        text: "alpha",
      },
      {
        kind: "document",
        sourceId: "doc_beta",
        contentHash: digest("2"),
        labels: ["beta"],
        text: "beta",
      },
    ]);
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
      queries: ["alpha", "beta"],
      durationMs: 12,
      status: "completed",
    });

    const result = await executeProjectedSearch({
      projection,
      index,
      finalLimit: 2,
      fusionPolicy: "query_coverage_interleave",
    });

    expect(result.hits.map((hit) => hit.source.sourceId)).toEqual(["doc_alpha", "doc_beta"]);
    expect(result.fusion).toMatchObject({
      algorithm: "query_coverage_interleave",
      rankConstant: null,
    });
  });

  it("rejects projection text that differs from the receipt", async () => {
    const index = new LexicalSearchIndex([
      {
        kind: "document",
        sourceId: "doc_alpha",
        contentHash: digest("1"),
        labels: ["alpha"],
        text: "alpha",
      },
    ]);
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
      queries: ["alpha"],
      durationMs: 12,
      status: "completed",
    });

    await expect(
      executeProjectedSearch({ projection: { ...projection, queries: ["beta"] }, index }),
    ).rejects.toThrow(/differs from its receipt/u);
  });
});
