import { describe, expect, it } from "vitest";

import {
  createSearchAssessment,
  createSearchAttempt,
  createSearchQualityReport,
  createSearchSelectionQualityReport,
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

  it("requires explicit assessment and never turns failures into an embedding decision", () => {
    const acceptedResponse = new LexicalSearchIndex(sources()).search("recovery");
    const acceptedAttempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "2".repeat(32),
      response: acceptedResponse,
    });
    const failedAttempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:01.000Z"),
      nonce: "3".repeat(32),
      response: new LexicalSearchIndex(sources()).search("quantum mechanics"),
    });
    const assessments = [
      createSearchAssessment({
        attempt: acceptedAttempt,
        assessedAt: new Date("2026-08-20T04:01:00.000Z"),
        assessor: "human",
        outcome: "accepted",
        selectedSources: [
          {
            sourceKind: acceptedAttempt.hits[0]!.sourceKind,
            sourceId: acceptedAttempt.hits[0]!.sourceId,
          },
        ],
      }),
      createSearchAssessment({
        attempt: failedAttempt,
        assessedAt: new Date("2026-08-20T04:01:01.000Z"),
        assessor: "human",
        outcome: "failed",
        failureReason: "no_results",
      }),
    ];

    expect(createSearchQualityReport([acceptedAttempt, failedAttempt], assessments)).toMatchObject({
      assessedAttempts: 2,
      acceptedAttempts: 1,
      failedAttempts: 1,
      failuresByReason: { no_results: 1 },
      evidenceState: "failures_observed",
      embeddingDecision: "not_determined",
    });
  });

  it("separates assessed quality by selection transition and adapter build without deciding rollout", () => {
    const baselineAttempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "9".repeat(32),
      response: new LexicalSearchIndex(sources()).search("recovery"),
    });
    const selectionTransitionId = `seact_${"b".repeat(24)}`;
    const candidateAttempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:01.000Z"),
      nonce: "a".repeat(32),
      response: {
        ...new LexicalSearchIndex(sources()).search("document"),
        engine: { id: "fixture_candidate", version: 1 },
      },
      selectionTransitionId,
    });
    const assessment = createSearchAssessment({
      attempt: candidateAttempt,
      assessedAt: new Date("2026-08-20T04:01:00.000Z"),
      assessor: "human",
      outcome: "accepted",
      selectedSources: [
        {
          sourceKind: candidateAttempt.hits[0]!.sourceKind,
          sourceId: candidateAttempt.hits[0]!.sourceId,
        },
      ],
    });
    const adapterBuildId = contentId("sebuild", { adapter: "fixture_candidate", revision: 1 });
    const report = createSearchSelectionQualityReport({
      attempts: [baselineAttempt, candidateAttempt],
      assessments: [assessment],
      coordinates: [
        {
          selectionTransitionId: null,
          engine: SEARCH_ENGINE,
          selectionState: "implicit_baseline",
          adapterBuildId: null,
          buildEvidenceState: "not_applicable",
        },
        {
          selectionTransitionId,
          engine: candidateAttempt.engine,
          selectionState: "candidate",
          adapterBuildId,
          buildEvidenceState: "bound",
        },
      ],
    });

    expect(report).toMatchObject({
      schemaVersion: 2,
      totalAttempts: 2,
      assessedAttempts: 1,
      rolloutDecision: "not_determined",
      rollbackDecision: "not_determined",
      embeddingDecision: "not_determined",
      selections: [
        {
          selectionState: "implicit_baseline",
          totalAttempts: 1,
          assessedAttempts: 0,
          evidenceState: "insufficient_assessment",
        },
        {
          selectionTransitionId,
          adapterBuildId,
          totalAttempts: 1,
          acceptedAttempts: 1,
          evidenceState: "no_failures_observed",
        },
      ],
    });
    expect(() =>
      createSearchSelectionQualityReport({
        attempts: [candidateAttempt],
        assessments: [assessment],
        coordinates: [],
      }),
    ).toThrow(/selection transition or engine quality coordinates/);
    expect(
      createSearchSelectionQualityReport({
        attempts: [candidateAttempt],
        assessments: [assessment],
        coordinates: [
          {
            selectionTransitionId,
            engine: candidateAttempt.engine,
            selectionState: "candidate",
            adapterBuildId: null,
            buildEvidenceState: "legacy_unbound",
          },
        ],
      }).selections[0],
    ).toMatchObject({
      buildEvidenceState: "legacy_unbound",
      adapterBuildId: null,
      acceptedAttempts: 1,
    });
    expect(() =>
      createSearchSelectionQualityReport({
        attempts: [candidateAttempt],
        assessments: [assessment],
        coordinates: [
          {
            selectionTransitionId,
            engine: { id: "different_candidate", version: 1 },
            selectionState: "candidate",
            adapterBuildId,
            buildEvidenceState: "bound",
          },
        ],
      }),
    ).toThrow(/engine quality coordinates/);
    expect(() =>
      createSearchSelectionQualityReport({
        attempts: [],
        assessments: [],
        coordinates: [
          {
            selectionTransitionId: null,
            engine: SEARCH_ENGINE,
            selectionState: "implicit_baseline",
            adapterBuildId: null,
            buildEvidenceState: "not_applicable",
          },
        ],
      }),
    ).toThrow(/coordinates exist without a search attempt/);
  });

  it("separates product-qualified quality from the implicit baseline", () => {
    const productQualificationId = `spqual_${"c".repeat(24)}`;
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "d".repeat(32),
      response: {
        ...new LexicalSearchIndex(sources()).search("recovery"),
        engine: { id: "lexical", version: 2 },
      },
      productQualificationId,
    });

    expect(
      createSearchSelectionQualityReport({
        attempts: [attempt],
        assessments: [],
        coordinates: [
          {
            selectionTransitionId: null,
            productQualificationId,
            engine: attempt.engine,
            selectionState: "product_default",
            adapterBuildId: null,
            buildEvidenceState: "product_qualified",
          },
        ],
      }).selections[0],
    ).toMatchObject({
      productQualificationId,
      selectionState: "product_default",
      totalAttempts: 1,
      buildEvidenceState: "product_qualified",
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

  it("does not accept no_results as a label when the attempt returned a result", () => {
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "4".repeat(32),
      response: new LexicalSearchIndex(sources()).search("recovery"),
    });

    expect(() =>
      createSearchAssessment({
        attempt,
        assessedAt: new Date("2026-08-20T04:01:00.000Z"),
        assessor: "human",
        outcome: "failed",
        failureReason: "no_results",
      }),
    ).toThrow(/target attempt/);
  });

  it("keeps source kind in assessment coordinates when IDs overlap", () => {
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "5".repeat(32),
      response: new LexicalSearchIndex(sources()).search("recovery"),
    });

    expect(() =>
      createSearchAssessment({
        attempt,
        assessedAt: new Date("2026-08-20T04:01:00.000Z"),
        assessor: "human",
        outcome: "accepted",
        selectedSources: [{ sourceKind: "skill", sourceId: attempt.hits[0]!.sourceId }],
      }),
    ).toThrow(/target attempt/);
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
