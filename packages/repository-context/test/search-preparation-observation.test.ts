import { describe, expect, it } from "vitest";
import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
} from "@lervo/search";

import { observeSearchPreparation } from "../src/search-preparation-observation.js";

function batch(nonce: string) {
  const response = new LexicalSearchIndex([
    {
      kind: "document",
      sourceId: "doc_source01",
      contentHash: `sha256:${"a".repeat(64)}`,
      path: "secret.md",
      title: "Evidence",
      labels: [],
      text: "runtime evidence",
    },
  ]).search("runtime", 5);
  return createSearchRecommendationBatch({
    attempt: createSearchAttempt({
      projectId: "prj_observe01",
      observedAt: new Date("2026-10-09T00:00:00Z"),
      nonce,
      response,
      selectionTransitionId: null,
    }),
  });
}

describe("shared search preparation normalization", () => {
  it("deduplicates exact versions while excluding receipt identity and private text", () => {
    const one = batch("a".repeat(32));
    const two = batch("b".repeat(32));
    const base = { query: "runtime", sourceSnapshotId: "ksnap_current" };
    const report = observeSearchPreparation({ ...base, recommendationBatches: [one, two] });
    expect(report).toEqual(observeSearchPreparation({ ...base, recommendationBatches: [one] }));
    expect(report).toMatchObject({
      candidateCount: 1,
      selectedCount: 1,
      loading: "unobserved",
      fullCount: null,
    });
    expect(JSON.stringify(report)).not.toContain("secret.md");
    expect(JSON.stringify(report)).not.toContain("runtime");
  });

  it("validates source recommendation receipts rather than trusting arbitrary selections", () => {
    const forged = batch("a".repeat(32));
    forged.selectedRecommendationIds = ["srec_forged"];
    expect(() =>
      observeSearchPreparation({
        query: "runtime",
        sourceSnapshotId: null,
        recommendationBatches: [forged],
      }),
    ).toThrow();
  });
});
