import { describe, expect, it } from "vitest";

import {
  createLexicalV2ProviderReport,
  summarizeLexicalV2ProviderRuns,
} from "../natural-language-evaluation/lexical-v2-provider-report.mjs";

function legacySummary(runs, arm) {
  const observations = runs.map((item) => item.arms[arm]);
  const usage = observations.map((item) => item.usage).filter((item) => item !== null);
  return {
    observations: observations.length,
    passed: observations.filter((item) => item.passed).length,
    casesPassingEveryRepetition: [...new Set(runs.map((item) => item.caseId))].filter((caseId) =>
      runs.filter((item) => item.caseId === caseId).every((item) => item.arms[arm].passed),
    ).length,
    expectedPathRecall:
      observations.reduce((sum, item) => sum + item.expectedPathRecall, 0) / observations.length,
    returnedPathPrecision:
      observations.reduce((sum, item) => sum + item.returnedPathPrecision, 0) / observations.length,
    failedContracts: observations.filter((item) => !item.passedContract).length,
    toolOrCommandObservations: observations.filter(
      (item) => item.completedToolCalls > 0 || item.completedCommands > 0,
    ).length,
    providerErrors: observations.reduce((sum, item) => sum + item.providerErrors, 0),
    totalDurationMs: observations.reduce((sum, item) => sum + item.durationMs, 0),
    totalTokens: usage.reduce((sum, item) => sum + item.totalTokens, 0),
    usageObserved: usage.length,
    totalInjectedBytes: observations.reduce((sum, item) => sum + item.injectedBytes, 0),
    structuredOutputRequested: observations.filter((item) => item.structuredOutputRequested).length,
  };
}

const acceptance = {
  requireCasePassNonRegression: true,
  requireRecallNonInferiority: true,
  requirePrecisionNonInferiority: true,
  maximumTokenRatioBasisPoints: 9_000,
  maximumDurationRatioBasisPoints: 9_500,
  maximumFailedContracts: 0,
  maximumToolOrCommandObservations: 0,
  requireCompleteUsage: true,
};

const observation = {
  passed: true,
  passedContract: true,
  expectedPathRecall: 1,
  returnedPathPrecision: 1,
  completedToolCalls: 0,
  completedCommands: 0,
  providerErrors: 0,
  durationMs: 10,
  usage: { totalTokens: 20 },
  injectedBytes: 30,
  structuredOutputRequested: true,
};

describe("lexical-v2 provider report", () => {
  it("preserves the legacy summary and byte-stable report shape", () => {
    const runs = [
      {
        caseId: "case-1",
        taskType: "task_start_and_how_to",
        repetition: 1,
        armOrder: ["lexical_v1", "lexical_v2"],
        arms: { lexical_v1: observation, lexical_v2: { ...observation, durationMs: 9 } },
      },
    ];
    expect(summarizeLexicalV2ProviderRuns(runs, "lexical_v1")).toEqual(
      legacySummary(runs, "lexical_v1"),
    );

    const input = {
      suiteId: "suite",
      suiteDigest: "sha256:suite",
      provider: "codex",
      model: "model",
      repositorySnapshot: { commit: "abc" },
      corpusDigest: "sha256:corpus",
      observedAt: "2026-08-31T00:00:00.000Z",
      acceptance,
      runs,
    };
    const report = createLexicalV2ProviderReport(input);
    const reparsed = JSON.parse(JSON.stringify(report));
    expect(JSON.stringify(reparsed)).toBe(JSON.stringify(report));
    expect(report.summary.lexicalV1).toEqual(legacySummary(runs, "lexical_v1"));
    expect(report.runs).toBe(runs);
  });
});
