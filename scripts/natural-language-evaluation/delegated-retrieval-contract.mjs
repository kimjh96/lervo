import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { boundedString, record, repositoryPath } from "./contract-common.mjs";

const taskTypes = new Set([
  "task_start_and_how_to",
  "historical_rationale",
  "status_continuation_impact",
  "ambiguity_and_contract_boundary",
]);
const fallbackTriggers = new Set([
  "lexical_only",
  "lexical_no_hits",
  "impact_verification",
  "approval_boundary_verification",
]);
const corpusRoots = ["README.md", "AGENTS.md", "docs"];
const corpusExclusions = [
  "docs/decisions/search/0224-natural-language-grounding-quality-evaluation.md",
  "docs/decisions/search/0225-revise-local-hybrid-for-cross-language-recall.md",
  "docs/decisions/search/0226-retire-local-hybrid-and-evaluate-bounded-model-fallback.md",
  "docs/decisions/knowledge/semantics/0227-approval-gated-cross-provider-fuzzy-merge.md",
  "docs/evidence/search",
  "docs/knowledge",
  "docs/roadmap/natural-language-grounding-quality.md",
];
const boundedFallbackAcceptance = {
  minimumCasesPassingEveryRepetition: 6,
  requirePassCountNonInferiorityToModelDirect: true,
  requireRecallNonInferiorityToModelDirect: true,
  maximumTokenRatioToModelDirectBasisPoints: 8_500,
  maximumDurationRatioToModelDirectBasisPoints: 9_500,
  maximumFailedFallbackTriggers: 0,
  maximumFailedContracts: 0,
};

function uniqueStrings(value, label, maximum) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must contain 1 to ${maximum} values.`);
  }
  const strings = value.map((item, index) => boundedString(item, `${label}[${index}]`));
  if (new Set(strings).size !== strings.length) throw new TypeError(`${label} must be unique.`);
  return strings;
}

export function validateDelegatedRetrievalSuite(value, repositoryRoot) {
  const suite = record(value, "delegated retrieval suite");
  const boundedFallback = suite.suiteId === "drbench_bounded_fallback.v1";
  if (
    suite.schemaVersion !== 1 ||
    (!boundedFallback && suite.suiteId !== "drbench_lexical_vs_model_direct.v1") ||
    suite.provenance !== "verification_authored" ||
    suite.reviewStatus !== "pending_human_review" ||
    suite.publicQueries !== true ||
    suite.modelResponseLocale !== "ko" ||
    !Number.isSafeInteger(suite.lexicalLimit) ||
    suite.lexicalLimit < 1 ||
    suite.lexicalLimit > 10 ||
    !Array.isArray(suite.cases) ||
    suite.cases.length !== 8 ||
    (boundedFallback &&
      (suite.benchmarkMode !== "bounded_fallback_comparison" || suite.repetitionsPerArm !== 2)) ||
    (!boundedFallback &&
      (suite.benchmarkMode !== undefined || suite.repetitionsPerArm !== undefined))
  ) {
    throw new TypeError("The delegated retrieval suite header is invalid.");
  }
  if (
    boundedFallback &&
    JSON.stringify(suite.acceptance) !== JSON.stringify(boundedFallbackAcceptance)
  ) {
    throw new TypeError("The bounded fallback acceptance contract is invalid.");
  }
  if (!boundedFallback && suite.acceptance !== undefined) {
    throw new TypeError("Acceptance is not part of the delegated retrieval pilot contract.");
  }
  const roots = uniqueStrings(suite.corpusRoots, "corpusRoots", 8).map((path, index) =>
    repositoryPath(path, `corpusRoots[${index}]`),
  );
  const exclusions = uniqueStrings(suite.corpusExclusions, "corpusExclusions", 16).map(
    (path, index) => repositoryPath(path, `corpusExclusions[${index}]`),
  );
  if (
    JSON.stringify(roots) !== JSON.stringify(corpusRoots) ||
    JSON.stringify(exclusions) !== JSON.stringify(corpusExclusions)
  ) {
    throw new TypeError("The delegated retrieval corpus permits self-influence or drift.");
  }
  const caseIds = new Set();
  for (const [index, rawCase] of suite.cases.entries()) {
    const item = record(rawCase, `cases[${index}]`);
    const caseId = boundedString(item.caseId, `cases[${index}].caseId`);
    if (!/^drcase_[a-z0-9_]{4,100}$/u.test(caseId) || caseIds.has(caseId)) {
      throw new TypeError(`cases[${index}].caseId is invalid or duplicated.`);
    }
    caseIds.add(caseId);
    if (!taskTypes.has(item.taskType)) {
      throw new TypeError(`cases[${index}].taskType is invalid.`);
    }
    if (boundedFallback) {
      if (!fallbackTriggers.has(item.fallbackTrigger)) {
        throw new TypeError(`cases[${index}].fallbackTrigger is invalid.`);
      }
      if (
        (item.fallbackTrigger === "impact_verification" &&
          item.taskType !== "status_continuation_impact") ||
        (item.fallbackTrigger === "approval_boundary_verification" &&
          item.taskType !== "ambiguity_and_contract_boundary") ||
        (item.fallbackTrigger === "lexical_no_hits" && item.taskType !== "historical_rationale")
      ) {
        throw new TypeError(`cases[${index}].fallbackTrigger contradicts its task type.`);
      }
    } else if (item.fallbackTrigger !== undefined) {
      throw new TypeError(`cases[${index}].fallbackTrigger is not part of the pilot contract.`);
    }
    boundedString(item.query, `cases[${index}].query`);
    uniqueStrings(item.expectedPaths, `cases[${index}].expectedPaths`, 4)
      .map((path, pathIndex) => repositoryPath(path, `cases[${index}].expectedPaths[${pathIndex}]`))
      .forEach((path) => {
        if (
          repositoryRoot !== undefined &&
          (!path.endsWith(".md") || !existsSync(resolve(repositoryRoot, path)))
        ) {
          throw new TypeError(`${caseId} expected path is not a current Markdown source.`);
        }
      });
  }
  for (const taskType of taskTypes) {
    if (!suite.cases.some((item) => item.taskType === taskType)) {
      throw new TypeError(`The delegated retrieval suite does not cover ${taskType}.`);
    }
  }
  return suite;
}

export function validateBoundedFallbackAlignment(pilotValue, fallbackValue) {
  const pilot = validateDelegatedRetrievalSuite(pilotValue);
  const fallback = validateDelegatedRetrievalSuite(fallbackValue);
  if (
    pilot.suiteId !== "drbench_lexical_vs_model_direct.v1" ||
    fallback.suiteId !== "drbench_bounded_fallback.v1"
  ) {
    throw new TypeError("The delegated retrieval comparison suites are misidentified.");
  }
  const comparisonFields = (suite) => ({
    modelResponseLocale: suite.modelResponseLocale,
    lexicalLimit: suite.lexicalLimit,
    corpusRoots: suite.corpusRoots,
    corpusExclusions: suite.corpusExclusions,
    cases: suite.cases.map(({ caseId, taskType, query, expectedPaths }) => ({
      caseId,
      taskType,
      query,
      expectedPaths,
    })),
  });
  if (JSON.stringify(comparisonFields(pilot)) !== JSON.stringify(comparisonFields(fallback))) {
    throw new TypeError("The bounded fallback suite changes the delegated retrieval ground truth.");
  }
  return fallback;
}

export function parseDelegatedRetrievalAnswer(content) {
  let value;
  try {
    value = JSON.parse(content.trim());
  } catch (error) {
    throw new TypeError("The provider did not return one JSON object.", { cause: error });
  }
  const answer = record(value, "delegated retrieval answer");
  const sourcePaths = Array.isArray(answer.sourcePaths)
    ? answer.sourcePaths.map((path, index) => repositoryPath(path, `sourcePaths[${index}]`))
    : [];
  if (
    boundedString(answer.answer, "answer").length > 4_000 ||
    sourcePaths.length > 10 ||
    new Set(sourcePaths).size !== sourcePaths.length ||
    !new Set(["high", "medium", "low"]).has(answer.confidence) ||
    typeof answer.abstained !== "boolean"
  ) {
    throw new TypeError("The delegated retrieval answer contract is invalid.");
  }
  return { ...answer, sourcePaths };
}

export function scoreDelegatedRetrievalAnswer(expectedPaths, answer) {
  const expected = new Set(expectedPaths);
  const returned = new Set(answer.sourcePaths);
  const matchedPaths = [...expected].filter((path) => returned.has(path)).sort();
  const unexpectedPaths = [...returned].filter((path) => !expected.has(path)).sort();
  return {
    passed: !answer.abstained && matchedPaths.length === expected.size,
    matchedPaths,
    missingPaths: [...expected].filter((path) => !returned.has(path)).sort(),
    unexpectedPaths,
    expectedPathRecall: matchedPaths.length / expected.size,
    returnedPathPrecision:
      returned.size === 0 ? (expected.size === 0 ? 1 : 0) : matchedPaths.length / returned.size,
  };
}

export function delegatedRetrievalDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
