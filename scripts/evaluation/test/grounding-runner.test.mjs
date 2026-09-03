import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertGroundingEvaluationPassed,
  runGroundingEvaluation,
} from "../../natural-language-evaluation/grounding-runner.mjs";

const root = resolve(import.meta.dirname, "../../..");
const loadSuite = () =>
  JSON.parse(
    readFileSync(resolve(root, "benchmarks/grounding/natural-language-repository-v1.json"), "utf8"),
  );

describe("provider-neutral grounding runner", () => {
  it("passes all reviewed dimensions without storing fixture text", () => {
    const suite = loadSuite();
    const report = runGroundingEvaluation(suite);

    expect(report.summary.passed).toBe(32);
    expect(report.summary.total).toBe(32);
    expect(Object.values(report.summary.dimensions)).toEqual(
      Array.from({ length: 6 }, () => ({ passed: 32, total: 32 })),
    );
    expect(report.privacy).toEqual({
      containsPromptText: false,
      containsPriorTurnText: false,
      containsAbsolutePaths: false,
      containsSourceBodies: false,
      containsJudgeRationale: false,
    });
    expect(JSON.stringify(report)).not.toContain(suite.cases[0].prompt);
    expect(report.summary.resolutionFailures).toEqual({
      expectation_unresolved: 11,
      expected_version_stale: 1,
    });
    expect(
      report.cases.find((item) => item.caseId === "ngcase_fail_hash_drift").resolutionFailure,
    ).toBe("expected_version_stale");
    expect(runGroundingEvaluation(suite).reportId).toBe(report.reportId);
    expect(() => assertGroundingEvaluationPassed(report)).not.toThrow();
  });

  it("scores intent independently from the other decisions", () => {
    const suite = loadSuite();
    const report = runGroundingEvaluation(suite, {
      resolver(item) {
        return item.caseId === "ngcase_shorthand_progress_question"
          ? { ...item.providerObservation, intent: "unknown" }
          : item.providerObservation;
      },
    });

    expect(report.summary.dimensions.intent).toEqual({ passed: 31, total: 32 });
    expect(report.summary.dimensions.referenceResolution).toEqual({ passed: 32, total: 32 });
    expect(report.summary.dimensions.disposition).toEqual({ passed: 32, total: 32 });
    expect(() => assertGroundingEvaluationPassed(report)).toThrow(
      "ngcase_shorthand_progress_question[intent]",
    );
  });

  it("covers multilingual, indirect, ambiguous, authority, and adversarial source-boundary cases", () => {
    const suite = loadSuite();
    const ids = new Set(suite.cases.map((item) => item.caseId));
    expect(ids.has("ngcase_mixed_hybrid_go")).toBe(true);
    expect(ids.has("ngcase_deictic_unique_action")).toBe(true);
    expect(ids.has("ngcase_ambiguous_two_targets")).toBe(true);
    expect(ids.has("ngcase_approval_multiple_pending")).toBe(true);
    expect(ids.has("ngcase_fail_unreviewed_graph")).toBe(true);
  });
});
