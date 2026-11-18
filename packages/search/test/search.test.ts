import { describe, expect, it } from "vitest";

import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  assertSearchRecommendationBatch,
  contentId,
  LexicalSearchIndex,
  prepareSearchCorpus,
  prepareReusableSearchCorpus,
  SEARCH_ENGINE,
  type SearchSourceInput,
} from "../src/index.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function sources(): SearchSourceInput[] {
  return [
    {
      kind: "document",
      sourceId: "doc_runtime_01",
      path: "docs/runtime.md",
      contentHash: HASH_A,
      title: "Execution state and recovery",
      labels: ["runtime"],
      text: "Interrupted execution is recovered from source events.",
    },
    {
      kind: "document",
      sourceId: "doc_lifecycle_01",
      path: "docs/document-lifecycle.md",
      contentHash: HASH_B,
      title: "Document lifecycle",
      labels: ["canonical", "documents"],
      text: "Split documents by topic and verify their staleness state.",
    },
  ];
}

describe("deterministic lexical search baseline", () => {
  it("ranks exact title and path evidence without returning source text", () => {
    const result = new LexicalSearchIndex(sources()).search("document lifecycle", 10);

    expect(result.hits[0]).toMatchObject({
      source: { sourceId: "doc_lifecycle_01", path: "docs/document-lifecycle.md" },
      rank: 1,
      matchedFields: expect.arrayContaining(["title", "text"]),
    });
    expect(JSON.stringify(result)).not.toContain("Split documents by topic");
  });

  it("produces the same index and ranking regardless of corpus input order", () => {
    const forward = new LexicalSearchIndex(sources());
    const reversed = new LexicalSearchIndex(sources().reverse());

    expect(reversed.indexId).toBe(forward.indexId);
    expect(forward.indexId).toBe(
      contentId("sidx", {
        engine: SEARCH_ENGINE,
        sources: prepareSearchCorpus(sources()).indexSources,
      }),
    );
    expect(reversed.search("recovery")).toEqual(forward.search("recovery"));
  });

  it("reuses only an immutable core-prepared corpus while preserving baseline output", () => {
    const reusable = prepareReusableSearchCorpus(sources());
    const observed: Array<{ sourceIndex: number; name: string; tokens: readonly string[] }> = [];
    const reused = LexicalSearchIndex.fromPreparedCorpus(reusable, (field) => {
      observed.push({ sourceIndex: field.sourceIndex, name: field.name, tokens: field.tokens });
    });
    const baseline = new LexicalSearchIndex(sources());

    expect(reused.indexId).toBe(baseline.indexId);
    expect(reused.search("document recovery", 50)).toEqual(
      baseline.search("document recovery", 50),
    );
    expect(observed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceIndex: 0, name: "title" }),
        expect.objectContaining({ sourceIndex: 1, name: "text" }),
      ]),
    );
    expect(Object.isFrozen(reusable)).toBe(true);
    expect(Object.isFrozen(reusable.sources)).toBe(true);
    expect(reusable.sources.every((source) => Object.isFrozen(source))).toBe(true);
    expect(() => LexicalSearchIndex.fromPreparedCorpus(prepareSearchCorpus(sources()))).toThrow(
      "core preparation boundary",
    );
  });

  it("changes the derived index identity when an original content hash changes", () => {
    const changed = sources();
    changed[0] = { ...changed[0]!, contentHash: `sha256:${"c".repeat(64)}` };

    expect(new LexicalSearchIndex(changed).indexId).not.toBe(
      new LexicalSearchIndex(sources()).indexId,
    );
  });

  it("binds ranking metadata and searchable text to the index identity", () => {
    const changed = sources();
    changed[0] = { ...changed[0]!, title: "Different title", labels: ["changed"] };

    expect(new LexicalSearchIndex(changed).indexId).not.toBe(
      new LexicalSearchIndex(sources()).indexId,
    );
  });

  it("records only a query digest and bounded result coordinates", () => {
    const response = new LexicalSearchIndex(sources()).search("recovery method");
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "1".repeat(32),
      response,
    });

    expect(JSON.stringify(attempt)).not.toContain("recovery method");
    expect(attempt.hits[0]).not.toHaveProperty("path");
  });

  it("binds candidate attempts and recommendations to the selection transition", () => {
    const response = {
      ...new LexicalSearchIndex(sources()).search("document recovery"),
      engine: { id: "fixture_candidate", version: 1 },
    };
    const selectionTransitionId = `seact_${"a".repeat(24)}`;
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "7".repeat(32),
      response,
      selectionTransitionId,
    });
    const batch = createSearchRecommendationBatch({
      attempt,
      recommendationLimit: 2,
      maximumSelections: 1,
    });

    expect(attempt).toMatchObject({ engine: response.engine, selectionTransitionId });
    expect(batch.recommendations[0]).toMatchObject({
      engine: response.engine,
      selectionTransitionId,
    });
    expect(() =>
      createSearchAttempt({
        projectId: "prj_search_01",
        observedAt: new Date("2026-08-20T04:00:00.000Z"),
        nonce: "8".repeat(32),
        response,
      }),
    ).toThrow(/selection transition ID/);
  });

  it("binds product-default attempts and recommendations to the shipped qualification", () => {
    const response = {
      ...new LexicalSearchIndex(sources()).search("document recovery"),
      engine: { id: "lexical", version: 2 },
    };
    const productQualificationId = `spqual_${"b".repeat(24)}`;
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "9".repeat(32),
      response,
      productQualificationId,
    });
    const batch = createSearchRecommendationBatch({
      attempt,
      recommendationLimit: 2,
      maximumSelections: 1,
    });

    expect(attempt).toMatchObject({
      engine: response.engine,
      selectionTransitionId: null,
      productQualificationId,
    });
    expect(batch.recommendations[0]).toMatchObject({
      engine: response.engine,
      selectionTransitionId: null,
      productQualificationId,
    });
  });

  it("rejects an unsafe repository path and an unbounded query", () => {
    expect(() => new LexicalSearchIndex([{ ...sources()[0]!, path: "../secret.md" }])).toThrow(
      /source coordinates/,
    );
    expect(() => new LexicalSearchIndex(sources()).search("word ".repeat(33))).toThrow(
      /between 1 and 32/,
    );
  });

  it("creates a bounded recommendation batch and keeps selection distinct", () => {
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "6".repeat(32),
      response: new LexicalSearchIndex(sources()).search("document recovery"),
    });
    const batch = createSearchRecommendationBatch({
      attempt,
      recommendationLimit: 2,
      maximumSelections: 1,
    });

    expect(batch.recommendations).toHaveLength(2);
    expect(batch.selectedRecommendationIds).toEqual([batch.recommendations[0]!.recommendationId]);
    expect(JSON.stringify(batch.recommendations)).not.toContain("document recovery");
    expect(() =>
      assertSearchRecommendationBatch({
        ...batch,
        selectedRecommendationIds: [batch.recommendations[1]!.recommendationId],
      }),
    ).toThrow(/source search attempt/);
  });
});
