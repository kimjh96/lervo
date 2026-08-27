import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateGroundingSuite } from "./natural-language-evaluation/grounding-contract.mjs";
import {
  assertGroundingEvaluationPassed,
  runGroundingEvaluation,
} from "./natural-language-evaluation/grounding-runner.mjs";
import { validateRetrievalPair } from "./natural-language-evaluation/retrieval-contract.mjs";
import { validateNaturalLanguageCaseReview } from "./natural-language-evaluation/case-review-contract.mjs";
import { validateLexicalFailureCandidates } from "./natural-language-evaluation/lexical-failure-contract.mjs";
import {
  validateBoundedFallbackAlignment,
  validateDelegatedRetrievalSuite,
} from "./natural-language-evaluation/delegated-retrieval-contract.mjs";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export {
  runGroundingEvaluation,
  validateGroundingSuite,
  validateLexicalFailureCandidates,
  validateNaturalLanguageCaseReview,
  validateRetrievalPair,
  validateBoundedFallbackAlignment,
  validateDelegatedRetrievalSuite,
};

export function checkNaturalLanguageEvaluation(repositoryRoot) {
  const koreanPath = resolve(
    repositoryRoot,
    "benchmarks/search/korean-repository-retrieval-v1.json",
  );
  const controlPath = resolve(
    repositoryRoot,
    "benchmarks/search/korean-repository-retrieval-control-v1.json",
  );
  const groundingPath = resolve(
    repositoryRoot,
    "benchmarks/grounding/natural-language-repository-v1.json",
  );
  const reviewPath = resolve(
    repositoryRoot,
    "benchmarks/reviews/natural-language-repository-v1.json",
  );
  const failureCandidatesPath = resolve(
    repositoryRoot,
    "benchmarks/search/natural-language-lexical-failure-candidates-v1.json",
  );
  const delegatedRetrievalPath = resolve(
    repositoryRoot,
    "benchmarks/search/delegated-retrieval-pilot-v1.json",
  );
  const boundedFallbackPath = resolve(
    repositoryRoot,
    "benchmarks/search/bounded-retrieval-fallback-v1.json",
  );
  const koreanSuite = loadJson(koreanPath);
  const controlSuite = loadJson(controlPath);
  const paired = validateRetrievalPair(repositoryRoot, koreanSuite, controlSuite);
  const groundingSuite = loadJson(groundingPath);
  const grounding = validateGroundingSuite(groundingSuite);
  const preReview = validateNaturalLanguageCaseReview(
    loadJson(reviewPath),
    koreanSuite,
    controlSuite,
    groundingSuite,
  );
  const lexicalFailures = validateLexicalFailureCandidates(
    loadJson(failureCandidatesPath),
    koreanSuite,
    controlSuite,
    repositoryRoot,
  );
  const groundingReport = runGroundingEvaluation(groundingSuite);
  const delegatedRetrievalSource = loadJson(delegatedRetrievalPath);
  const delegatedRetrieval = validateDelegatedRetrievalSuite(
    delegatedRetrievalSource,
    repositoryRoot,
  );
  const boundedFallback = validateBoundedFallbackAlignment(
    delegatedRetrievalSource,
    loadJson(boundedFallbackPath),
  );
  validateDelegatedRetrievalSuite(boundedFallback, repositoryRoot);
  assertGroundingEvaluationPassed(groundingReport);
  return {
    ...paired,
    ...grounding,
    ...preReview,
    ...lexicalFailures,
    groundingReportId: groundingReport.reportId,
    delegatedRetrievalCaseCount: delegatedRetrieval.cases.length,
    boundedFallbackCaseCount: boundedFallback.cases.length,
  };
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkNaturalLanguageEvaluation(repositoryRoot);
  console.log(
    `Natural-language evaluation check passed (${result.pairCount} retrieval pairs, ${result.caseCount} grounding cases across ${result.categoryCount} categories, ${result.lexicalFailureCandidateCount} lexical failure candidates across ${result.lexicalFailureTaskTypeCount} task types, ${result.lexicalDiscoveryProbeCount} discovery probes, ${result.delegatedRetrievalCaseCount} delegated retrieval cases, ${result.boundedFallbackCaseCount} bounded fallback cases, ${result.preReviewAttentionCount} pre-review attention items, report ${result.groundingReportId})`,
  );
}
