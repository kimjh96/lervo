import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  boundedArray,
  boundedString,
  canonicalDigest,
  fail,
  record,
  repositoryPath,
} from "./contract-common.mjs";

const taskTypes = [
  "task_start_and_how_to",
  "historical_rationale",
  "status_continuation_impact",
  "ambiguity_and_contract_boundary",
];

function sha256(value, label) {
  const digest = boundedString(value, label, 71);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) fail(`${label} is not a SHA-256 digest`);
  return digest;
}

function sourceReports(value, korean, control) {
  const reports = boundedArray(value, "lexical failure source reports", 2, 2);
  const expectations = [
    { language: "ko", suite: korean },
    { language: "en", suite: control },
  ];
  for (const [index, expected] of expectations.entries()) {
    const report = record(reports[index], `lexical failure source reports[${index}]`);
    if (
      report.language !== expected.language ||
      report.suiteId !== expected.suite.suiteId ||
      report.suiteDigest !== canonicalDigest(expected.suite, false) ||
      !/^spreport_[a-f0-9]{24}$/u.test(report.reportId)
    ) {
      fail("lexical failure source report binding is invalid or stale");
    }
  }
}

function pairedCase(caseId, pairId, language, korean, control) {
  const suite = language === "ko" ? korean : control;
  const item = suite.cases.find((candidate) => candidate.caseId === caseId);
  if (item === undefined || item.pairId !== pairId) {
    fail(`${caseId} does not bind to its declared retrieval pair`);
  }
  return item;
}

function result(value, label, allowedOutcomes) {
  const item = record(value, label);
  if (!allowedOutcomes.has(item.outcome)) fail(`${label} has an invalid outcome`);
  const rank = item.firstExpectedRank;
  const found = item.foundSourceCount;
  if (!Number.isInteger(found) || found < 0 || found > 8) {
    fail(`${label} has an invalid found-source count`);
  }
  if (item.outcome === "failed") {
    if (rank !== null || found !== 0) fail(`${label} does not represent a top-10 failure`);
  } else if (!Number.isInteger(rank) || rank < 1 || rank > 10 || found < 1) {
    fail(`${label} does not represent a top-10 recovery`);
  }
}

function validateDiscoveryProbes(value, repositoryRoot) {
  const probes = boundedArray(value, "lexical discovery probes", 1, 8);
  const seenIds = new Set();
  const seenQueries = new Set();
  const seenAttempts = new Set();
  for (const [index, value] of probes.entries()) {
    const item = record(value, `lexical discovery probes[${index}]`);
    const probeId = boundedString(item.probeId, `lexical discovery probes[${index}].probeId`, 128);
    const query = boundedString(item.query, `${probeId}.query`, 500);
    if (
      item.taskType !== "historical_rationale" ||
      item.provenance !== "verification_authored" ||
      item.reviewStatus !== "pending_human_review" ||
      !/[\p{Script=Hangul}]/u.test(query)
    ) {
      fail(`${probeId} overstates review or is not a Korean historical-rationale probe`);
    }
    const paths = boundedArray(item.expectedPaths, `${probeId}.expectedPaths`, 1, 4).map(
      (path, pathIndex) => repositoryPath(path, `${probeId}.expectedPaths[${pathIndex}]`),
    );
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path) => !path.endsWith(".md") || !existsSync(resolve(repositoryRoot, path)))
    ) {
      fail(`${probeId} has an invalid expected source`);
    }
    const observation = record(item.operationalObservation, `${probeId}.operationalObservation`);
    const attemptId = boundedString(observation.attemptId, `${probeId}.attemptId`, 128);
    const expectedQueryDigest = `sha256:${createHash("sha256").update(query).digest("hex")}`;
    if (
      !/^sat_[a-f0-9]{24}$/u.test(attemptId) ||
      observation.engine?.id !== "lexical" ||
      observation.engine?.version !== 1 ||
      observation.outcome !== "no_hits" ||
      observation.queryDigest !== expectedQueryDigest ||
      observation.resultSetHash !==
        "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    ) {
      fail(`${probeId} has an invalid operational no-hit observation`);
    }
    if (seenIds.has(probeId) || seenQueries.has(query) || seenAttempts.has(attemptId)) {
      fail("lexical discovery probes repeat identity, text, or attempts");
    }
    seenIds.add(probeId);
    seenQueries.add(query);
    seenAttempts.add(attemptId);
  }
  return probes.length;
}

export function validateLexicalFailureCandidates(value, korean, control, repositoryRoot) {
  const bundle = record(value, "lexical failure candidate bundle");
  if (
    bundle.schemaVersion !== 1 ||
    bundle.bundleId !== "nlfail_repository_natural_language.v1" ||
    bundle.provenance !== "verification_authored" ||
    bundle.reviewStatus !== "pending_human_review" ||
    bundle.observationBasis !== "owner_only_benchmark_reports_and_operational_attempts" ||
    bundle.activationAuthority !== "none"
  ) {
    fail("lexical failure bundle overstates review or activation authority");
  }
  sha256(bundle.corpusDigest, "lexical failure corpus digest");
  sourceReports(bundle.sourceReports, korean, control);

  const seenCases = new Set();
  const observedCounts = new Map(taskTypes.map((taskType) => [taskType, 0]));
  const failures = boundedArray(bundle.failures, "lexical failures", 1, 40);
  for (const [index, value] of failures.entries()) {
    const item = record(value, `lexical failures[${index}]`);
    const caseId = boundedString(item.caseId, `lexical failures[${index}].caseId`, 128);
    const pairId = boundedString(item.pairId, `${caseId}.pairId`, 128);
    if (!new Set(["ko", "en"]).has(item.language)) fail(`${caseId} has an invalid language`);
    const suiteCase = pairedCase(caseId, pairId, item.language, korean, control);
    if (item.taskType !== suiteCase.taskType || !taskTypes.includes(item.taskType)) {
      fail(`${caseId} has an invalid task type`);
    }
    if (seenCases.has(caseId)) fail("lexical failure bundle repeats a case");
    seenCases.add(caseId);
    result(item.baseline, `${caseId}.baseline`, new Set(["failed"]));
    result(item.candidate, `${caseId}.candidate`, new Set(["failed", "recovered"]));
    observedCounts.set(item.taskType, observedCounts.get(item.taskType) + 1);
  }

  const regressions = boundedArray(bundle.rankingRegressions, "ranking regressions", 1, 40);
  const seenRegressions = new Set();
  for (const [index, value] of regressions.entries()) {
    const item = record(value, `ranking regressions[${index}]`);
    const caseId = boundedString(item.caseId, `ranking regressions[${index}].caseId`, 128);
    const suiteCase = pairedCase(caseId, item.pairId, item.language, korean, control);
    if (item.taskType !== suiteCase.taskType) fail(`${caseId} regression has an invalid task type`);
    if (
      !Number.isInteger(item.baselineFirstExpectedRank) ||
      !Number.isInteger(item.candidateFirstExpectedRank) ||
      item.baselineFirstExpectedRank < 1 ||
      item.candidateFirstExpectedRank > 10 ||
      item.candidateFirstExpectedRank <= item.baselineFirstExpectedRank
    ) {
      fail(`${caseId} is not a bounded rank regression`);
    }
    if (seenRegressions.has(caseId)) fail("ranking regressions repeat a case");
    seenRegressions.add(caseId);
  }
  const discoveryProbeCount = validateDiscoveryProbes(bundle.discoveryProbes, repositoryRoot);

  const coverage = boundedArray(bundle.taskTypeCoverage, "lexical failure task coverage", 4, 4);
  for (const [index, taskType] of taskTypes.entries()) {
    const item = record(coverage[index], `lexical failure task coverage[${index}]`);
    if (item.taskType !== taskType || item.failureCount !== observedCounts.get(taskType)) {
      fail("lexical failure task coverage is stale or out of order");
    }
  }
  const allCovered = [...observedCounts.values()].every((count) => count > 0);
  if (bundle.allTaskTypesCovered !== allCovered) {
    fail("lexical failure all-task-types claim is inaccurate");
  }
  const privacy = record(bundle.privacy, "lexical failure privacy");
  if (
    privacy.benchmarkReportQueries !== "excluded" ||
    privacy.discoveryProbeText !== "checked_in_public" ||
    privacy.sourcePathsAndBodies !== "expected_coordinates_only"
  ) {
    fail("lexical failure privacy declaration is invalid");
  }
  return {
    lexicalFailureCandidateCount: failures.length,
    lexicalFailureTaskTypeCount: [...observedCounts.values()].filter((count) => count > 0).length,
    lexicalRankingRegressionCount: regressions.length,
    lexicalDiscoveryProbeCount: discoveryProbeCount,
  };
}
