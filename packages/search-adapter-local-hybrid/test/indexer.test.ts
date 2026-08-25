import {
  createSearchAssessment,
  createSearchAttempt,
  createSearchEvaluationCase,
  executeSearchEvaluation,
  LexicalSearchIndex,
  verifySearchEvaluationEngineContract,
  type SearchSourceInput,
} from "@lervo/search";
import { describe, expect, it } from "vitest";

import { LocalHybridSearchIndex, localHybridSearchEvaluationEngine } from "../src/index.js";

const sources: SearchSourceInput[] = [
  {
    kind: "document",
    sourceId: "doc_auth",
    contentHash: `sha256:${"1".repeat(64)}`,
    path: "docs/auth.md",
    title: "Identity",
    labels: ["security"],
    text: "The service authenticates every request.",
  },
  {
    kind: "document",
    sourceId: "doc_cache",
    contentHash: `sha256:${"2".repeat(64)}`,
    path: "docs/cache.md",
    title: "Cache",
    labels: ["runtime"],
    text: "Cached results expire deterministically.",
  },
];

describe("deterministic local hybrid search", () => {
  it("passes the common engine contract with reversed corpus replay", async () => {
    const report = await verifySearchEvaluationEngineContract({
      engine: localHybridSearchEvaluationEngine,
      sources,
      queries: ["authentication", "runtime cache"],
    });
    expect(report.checkedQueries).toBe(2);
  });

  it("finds a morphology-adjacent document missed by exact keyword terms", () => {
    const response = new LocalHybridSearchIndex(sources).search("authentication", 10);
    expect(response.hits[0]).toMatchObject({
      source: { sourceId: "doc_auth" },
      rank: 1,
      score: expect.any(Number),
    });
    expect(response.hits[0]?.matchedFields).toContain("text");
  });

  it("beats the lexical baseline on the same reviewed top-10 case", async () => {
    const query = "authentication";
    const observedAt = new Date("2026-08-25T00:00:00Z");
    const referenceAttempt = createSearchAttempt({
      projectId: "prj_hybrid_compare_01",
      observedAt,
      nonce: "a".repeat(32),
      response: new LexicalSearchIndex(sources).search(query, 50),
    });
    const assessment = createSearchAssessment({
      attempt: referenceAttempt,
      assessedAt: new Date("2026-08-25T00:01:00Z"),
      assessor: "human",
      outcome: "failed",
      failureReason: "expected_source_missing",
      expectedSources: [{ sourceKind: "document", sourceId: "doc_auth" }],
    });
    const evaluationCase = createSearchEvaluationCase({
      attempt: referenceAttempt,
      assessment,
      query,
      maximumRank: 10,
    });
    const [baseline, candidate] = await Promise.all([
      executeSearchEvaluation({
        index: new LexicalSearchIndex(sources),
        cases: [evaluationCase],
        evaluatedAt: new Date("2026-08-25T00:02:00Z"),
      }),
      executeSearchEvaluation({
        index: new LocalHybridSearchIndex(sources),
        cases: [evaluationCase],
        evaluatedAt: new Date("2026-08-25T00:02:00Z"),
      }),
    ]);

    expect(baseline.results[0]?.status).toBe("failed");
    expect(candidate.results[0]?.status).toBe("passed");
    expect(evaluationCase.expectation.maximumRank).toBe(10);
  });
});
