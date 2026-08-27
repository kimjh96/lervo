import { createHash } from "node:crypto";

import { validateGroundingSuite } from "./grounding-contract.mjs";
const dimensions = [
  "intent",
  "referenceResolution",
  "sourceClasses",
  "disposition",
  "requiredBehaviors",
  "prohibitedBehaviors",
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(`${JSON.stringify(canonical(value))}\n`)
    .digest("hex")}`;
}

function valuesMatch(dimension, actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return actual === expected;
  const actualValues = [...actual].sort();
  const expectedValues = [...expected].sort();
  return JSON.stringify(actualValues) === JSON.stringify(expectedValues);
}

function resolutionFailure(item, actual) {
  if (!new Set(["clarify", "abstain"]).has(actual.disposition)) return null;
  return item.context.repositoryCondition === "hash_drift"
    ? "expected_version_stale"
    : "expectation_unresolved";
}

function evaluateCase(item, resolver) {
  const actual = resolver(item);
  const verdicts = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      valuesMatch(dimension, actual[dimension], item.expectation[dimension]),
    ]),
  );
  return {
    caseId: item.caseId,
    category: item.category,
    passed: Object.values(verdicts).every(Boolean),
    resolutionFailure: resolutionFailure(item, actual),
    verdicts,
  };
}

function dimensionSummary(cases) {
  return Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      {
        passed: cases.filter((item) => item.verdicts[dimension]).length,
        total: cases.length,
      },
    ]),
  );
}

function categorySummary(cases) {
  return Object.fromEntries(
    [...new Set(cases.map((item) => item.category))].map((category) => {
      const categoryCases = cases.filter((item) => item.category === category);
      return [
        category,
        {
          passed: categoryCases.filter((item) => item.passed).length,
          total: categoryCases.length,
        },
      ];
    }),
  );
}

function failureSummary(cases) {
  return Object.fromEntries(
    ["expectation_unresolved", "expected_version_stale"].map((failure) => [
      failure,
      cases.filter((item) => item.resolutionFailure === failure).length,
    ]),
  );
}

export function runGroundingEvaluation(suite, options = {}) {
  validateGroundingSuite(suite);
  const resolver = options.resolver ?? ((item) => item.providerObservation);
  const cases = suite.cases.map((item) => evaluateCase(item, resolver));
  const reportWithoutId = {
    schemaVersion: 1,
    reportKind: "deterministic_grounding_observation",
    suiteId: suite.suiteId,
    suiteDigest: digest(suite),
    runnerId: "typed-provider-observation-v2",
    provenance: suite.provenance,
    reviewStatus: suite.reviewStatus,
    privacy: {
      containsPromptText: false,
      containsPriorTurnText: false,
      containsAbsolutePaths: false,
      containsSourceBodies: false,
      containsJudgeRationale: false,
    },
    summary: {
      passed: cases.filter((item) => item.passed).length,
      total: cases.length,
      dimensions: dimensionSummary(cases),
      categories: categorySummary(cases),
      resolutionFailures: failureSummary(cases),
    },
    cases,
  };
  return { reportId: `ngreport_${digest(reportWithoutId).slice(7, 31)}`, ...reportWithoutId };
}

export function assertGroundingEvaluationPassed(report) {
  if (report.summary.passed === report.summary.total) return;
  const failed = report.cases
    .filter((item) => !item.passed)
    .map((item) => {
      const dimensions = Object.entries(item.verdicts)
        .filter(([, passed]) => !passed)
        .map(([dimension]) => dimension)
        .join(",");
      return `${item.caseId}[${dimensions}]`;
    });
  throw new Error(`Grounding evaluation failed: ${failed.join("; ")}`);
}
