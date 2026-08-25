import {
  canonicalHash,
  contentId,
  runSearchPerformanceBenchmark,
  type SearchEvaluationEnginePort,
} from "../src/index.js";
import { LexicalSearchIndex } from "../src/engine.js";
import { describe, expect, it } from "vitest";

const corpus = Array.from({ length: 6 }, (_, index) => ({
  kind: "document" as const,
  sourceId: `doc_source_${index}`,
  contentHash: `sha256:${String(index).padStart(64, "0")}`,
  path: `docs/${index}.md`,
  title: `Topic ${index}`,
  labels: [],
  text: index === 0 ? "normalization evidence" : `unrelated source ${index}`,
}));

function engine(id: string, recover: boolean): SearchEvaluationEnginePort {
  return {
    engine: { id, version: 1 },
    adapterBuildId: contentId("sebuild", { id }),
    buildIndex(sources) {
      const lexical = new LexicalSearchIndex(sources);
      const indexId = contentId("sidx", { id, corpus: lexical.corpusDigest });
      return {
        engine: { id, version: 1 },
        indexId,
        search(query, limit) {
          const response = lexical.search(query, limit);
          if (!recover || query !== "normalizing")
            return { ...response, engine: { id, version: 1 }, indexId };
          const source = sources[0]!;
          const hits = [
            {
              source: {
                kind: source.kind,
                sourceId: source.sourceId,
                contentHash: source.contentHash,
                ...(source.path === undefined ? {} : { path: source.path }),
              },
              rank: 1,
              score: 1,
              matchedFields: ["text" as const],
            },
          ];
          return {
            ...response,
            engine: { id, version: 1 },
            indexId,
            hits,
            resultSetHash: canonicalHash(hits),
          };
        },
      };
    },
  };
}

describe("search performance benchmark", () => {
  it("separates deterministic quality from observational timing and excludes private source", async () => {
    let tick = 0n;
    const cases = Array.from({ length: 5 }, (_, index) => ({
      caseId: `spcase_case_${index}`,
      taskType: "wording_variation",
      provenance: "verification_authored" as const,
      query: "normalizing",
      expectedSources: [{ kind: "document" as const, sourceId: "doc_source_0" }],
      maximumRank: 10 as const,
    }));
    const report = await runSearchPerformanceBenchmark({
      suiteId: "spbench_fixture.v1",
      suiteHash: `sha256:${"a".repeat(64)}`,
      suiteQueries: "owner_readable_case_records",
      corpus,
      corpusByteCount: 100,
      cases,
      baselineEngine: engine("baseline", false),
      candidateEngine: engine("candidate", true),
      evaluatedAt: new Date("2026-08-25T00:00:00.000Z"),
      environment: {
        platform: "test",
        release: "test",
        architecture: "test",
        processor: "test",
        logicalProcessorCount: 1,
        totalMemoryBytes: 1,
        freeMemoryBytes: 1,
        runtime: "test",
        runtimeFlags: [],
        hostnameDigest: `sha256:${"b".repeat(64)}`,
        powerMode: "unobserved",
        competingWorkloads: "unobserved",
      },
      protocol: {
        buildWarmupPairs: 1,
        buildRecordedPairs: 2,
        queryWarmupPasses: 1,
        queryRecordedRepetitions: 2,
        requestedLimit: 50,
      },
      clock: () => {
        tick += 100n;
        return tick;
      },
    });
    expect(report.candidate.quality.successfulCases).toBe(5);
    expect(report.baseline.quality.successfulCases).toBe(0);
    expect(report.comparison.taskTypes[0]).toMatchObject({
      candidateWins: 5,
      baselineWins: 0,
      comparisonState: "passed",
    });
    expect(report.comparison.qualityObservation).toBe("meaningful_gain_observed");
    expect(report.comparison.rankingObservation).toBe("aggregate_gain_no_case_regression");
    expect(report.baseline.buildLatency.sampleCount).toBe(2);
    expect(report.candidate.warmQueryLatency.sampleCount).toBe(10);
    expect(JSON.stringify(report)).not.toContain("normalizing");
    expect(JSON.stringify(report)).not.toContain("docs/0.md");
    expect(report.comparison.adoptionDecision).toBe("not_determined");
    expect(report.benchmarkBuildId).toMatch(/^spbuild_[a-f0-9]{24}$/u);
  });
});
