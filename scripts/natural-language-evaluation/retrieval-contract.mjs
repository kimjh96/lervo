import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { boundedArray, boundedString, fail, record, repositoryPath } from "./contract-common.mjs";

const taskTypes = [
  "task_start_and_how_to",
  "historical_rationale",
  "status_continuation_impact",
  "ambiguity_and_contract_boundary",
];

const corpusRoots = ["README.md", "AGENTS.md", "docs"];
const corpusExclusions = [
  "docs/decisions/search/0224-natural-language-grounding-quality-evaluation.md",
  "docs/evidence/search",
  "docs/knowledge",
  "docs/roadmap/natural-language-grounding-quality.md",
];

function validateRetrievalSuite(root, value, expectedSuiteId) {
  const suite = record(value, expectedSuiteId);
  if (
    suite.schemaVersion !== 1 ||
    suite.suiteId !== expectedSuiteId ||
    suite.publicQueries !== true
  ) {
    fail(`${expectedSuiteId} header is invalid`);
  }
  const roots = boundedArray(suite.corpusRoots, `${expectedSuiteId}.corpusRoots`, 1, 8).map(
    (path, index) => repositoryPath(path, `${expectedSuiteId}.corpusRoots[${index}]`),
  );
  const exclusions = boundedArray(
    suite.corpusExclusions,
    `${expectedSuiteId}.corpusExclusions`,
    0,
    8,
  ).map((path, index) => repositoryPath(path, `${expectedSuiteId}.corpusExclusions[${index}]`));
  if (
    JSON.stringify(roots) !== JSON.stringify(corpusRoots) ||
    JSON.stringify(exclusions) !== JSON.stringify(corpusExclusions)
  ) {
    fail(`${expectedSuiteId} corpus boundary permits self-influence or drift`);
  }
  const declaredTypes = boundedArray(suite.taskTypes, `${expectedSuiteId}.taskTypes`, 4, 4).map(
    (value, index) => {
      const item = record(value, `${expectedSuiteId}.taskTypes[${index}]`);
      if (item.minimumCases !== 5) fail(`${expectedSuiteId} task type minimum is not five`);
      return boundedString(item.taskType, `${expectedSuiteId}.taskTypes[${index}].taskType`, 96);
    },
  );
  if (JSON.stringify(declaredTypes) !== JSON.stringify(taskTypes)) {
    fail(`${expectedSuiteId} task types differ from the reviewed order`);
  }
  const cases = boundedArray(suite.cases, `${expectedSuiteId}.cases`, 20, 20).map(
    (value, index) => {
      const item = record(value, `${expectedSuiteId}.cases[${index}]`);
      const caseId = boundedString(item.caseId, `${expectedSuiteId}.cases[${index}].caseId`, 128);
      const pairId = boundedString(item.pairId, `${caseId}.pairId`, 128);
      const taskType = boundedString(item.taskType, `${caseId}.taskType`, 96);
      if (!taskTypes.includes(taskType)) fail(`${caseId} has an unknown task type`);
      if (item.provenance !== "verification_authored")
        fail(`${caseId} overstates review provenance`);
      const query = boundedString(item.query, `${caseId}.query`, 500);
      const expectedPaths = boundedArray(item.expectedPaths, `${caseId}.expectedPaths`, 1, 8).map(
        (path, pathIndex) => repositoryPath(path, `${caseId}.expectedPaths[${pathIndex}]`),
      );
      if (new Set(expectedPaths).size !== expectedPaths.length) {
        fail(`${caseId} repeats an expected path`);
      }
      for (const path of expectedPaths) {
        if (!path.endsWith(".md") || !existsSync(resolve(root, path))) {
          fail(`${caseId} expected path is not a current Markdown source: ${path}`);
        }
      }
      if (item.maximumRank !== 10) fail(`${caseId} does not use the reviewed top-10 contract`);
      return { caseId, pairId, taskType, query, expectedPaths, maximumRank: item.maximumRank };
    },
  );
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) {
    fail(`${expectedSuiteId} repeats case IDs`);
  }
  if (new Set(cases.map((item) => item.pairId)).size !== cases.length) {
    fail(`${expectedSuiteId} repeats pair IDs`);
  }
  if (new Set(cases.map((item) => item.query)).size !== cases.length) {
    fail(`${expectedSuiteId} repeats queries`);
  }
  for (const taskType of taskTypes) {
    if (cases.filter((item) => item.taskType === taskType).length !== 5) {
      fail(`${expectedSuiteId} does not contain five ${taskType} cases`);
    }
  }
  return { roots, exclusions, cases };
}

export function validateRetrievalPair(root, koreanValue, controlValue) {
  const korean = validateRetrievalSuite(
    root,
    koreanValue,
    "spbench_korean_repository_retrieval.v1",
  );
  const control = validateRetrievalSuite(
    root,
    controlValue,
    "spbench_korean_repository_retrieval_control.v1",
  );
  if (
    JSON.stringify(korean.roots) !== JSON.stringify(control.roots) ||
    JSON.stringify(korean.exclusions) !== JSON.stringify(control.exclusions)
  ) {
    fail("paired retrieval suites use different corpora");
  }
  const controls = new Map(control.cases.map((item) => [item.pairId, item]));
  for (const item of korean.cases) {
    const counterpart = controls.get(item.pairId);
    if (counterpart === undefined) fail(`${item.pairId} has no English control`);
    if (!/[\p{Script=Hangul}]/u.test(item.query)) {
      fail(`${item.pairId} Korean-framed query has no Hangul`);
    }
    if (/[\p{Script=Hangul}]/u.test(counterpart.query)) {
      fail(`${item.pairId} English control contains Hangul`);
    }
    if (
      counterpart.taskType !== item.taskType ||
      counterpart.maximumRank !== item.maximumRank ||
      JSON.stringify(counterpart.expectedPaths) !== JSON.stringify(item.expectedPaths)
    ) {
      fail(`${item.pairId} changes more than prompt language and framing`);
    }
    if (counterpart.query === item.query) fail(`${item.pairId} has identical paired queries`);
  }
  return { pairCount: korean.cases.length };
}
