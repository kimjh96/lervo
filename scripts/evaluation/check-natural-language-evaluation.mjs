import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateGroundingSuite } from "../natural-language-evaluation/grounding-contract.mjs";
import {
  assertGroundingEvaluationPassed,
  runGroundingEvaluation,
} from "../natural-language-evaluation/grounding-runner.mjs";
import { validateRetrievalPair } from "../natural-language-evaluation/retrieval-contract.mjs";
import { validateNaturalLanguageCaseReview } from "../natural-language-evaluation/case-review-contract.mjs";
import { validateLexicalFailureCandidates } from "../natural-language-evaluation/lexical-failure-contract.mjs";
import {
  validateBoundedFallbackAlignment,
  validateDelegatedRetrievalSuite,
} from "../natural-language-evaluation/delegated-retrieval-contract.mjs";
import { validateLexicalAssistedV2Suite } from "../natural-language-evaluation/lexical-assisted-v2-contract.mjs";
import {
  validateCatalogAssistedV3Alignment,
  validateCatalogAssistedV3Suite,
} from "../natural-language-evaluation/catalog-assisted-v3-contract.mjs";
import {
  validateCoreTermAssistedV4Alignment,
  validateCoreTermAssistedV4Suite,
} from "../natural-language-evaluation/core-term-assisted-v4-contract.mjs";
import {
  validateReferenceMarkerAssistedV5Alignment,
  validateReferenceMarkerAssistedV5Suite,
} from "../natural-language-evaluation/reference-marker-assisted-v5-contract.mjs";
import { validateMarkerDerivedPathsV6Suite } from "../natural-language-evaluation/marker-derived-paths-v6-contract.mjs";
import { validateStagedEvidenceV7Suite } from "../natural-language-evaluation/staged-evidence-v7-contract.mjs";
import { validateLinkedEvidenceReconciliationV8Suite } from "../natural-language-evaluation/linked-evidence-reconciliation-v8-contract.mjs";
import { validateLinkedEvidenceReconciliationConfirmationV9Suite } from "../natural-language-evaluation/linked-evidence-reconciliation-confirmation-v9-contract.mjs";
import { validateLexicalV2ProviderSuite } from "../natural-language-evaluation/lexical-v2-provider-comparison-contract.mjs";
import { validateLexicalV2RealUseReview } from "../natural-language-evaluation/lexical-v2-real-use-review-contract.mjs";

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
  validateLexicalAssistedV2Suite,
  validateCatalogAssistedV3Alignment,
  validateCatalogAssistedV3Suite,
  validateCoreTermAssistedV4Alignment,
  validateCoreTermAssistedV4Suite,
  validateReferenceMarkerAssistedV5Alignment,
  validateReferenceMarkerAssistedV5Suite,
  validateMarkerDerivedPathsV6Suite,
  validateStagedEvidenceV7Suite,
  validateLinkedEvidenceReconciliationV8Suite,
  validateLinkedEvidenceReconciliationConfirmationV9Suite,
  validateLexicalV2ProviderSuite,
  validateLexicalV2RealUseReview,
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
  const lexicalAssistedV2Path = resolve(
    repositoryRoot,
    "benchmarks/search/lexical-assisted-v2.json",
  );
  const catalogAssistedV3Path = resolve(
    repositoryRoot,
    "benchmarks/search/catalog-assisted-v3.json",
  );
  const coreTermAssistedV4Path = resolve(
    repositoryRoot,
    "benchmarks/search/core-term-assisted-v4.json",
  );
  const referenceMarkerAssistedV5Path = resolve(
    repositoryRoot,
    "benchmarks/search/reference-marker-assisted-v5.json",
  );
  const markerDerivedPathsV6Path = resolve(
    repositoryRoot,
    "benchmarks/search/marker-derived-paths-v6.json",
  );
  const stagedEvidenceV7Path = resolve(repositoryRoot, "benchmarks/search/staged-evidence-v7.json");
  const linkedEvidenceReconciliationV8Path = resolve(
    repositoryRoot,
    "benchmarks/search/linked-evidence-reconciliation-v8.json",
  );
  const linkedEvidenceReconciliationConfirmationV9Path = resolve(
    repositoryRoot,
    "benchmarks/search/linked-evidence-reconciliation-confirmation-v9.json",
  );
  const lexicalV2ProviderPath = resolve(
    repositoryRoot,
    "benchmarks/search/lexical-v2-provider-comparison-v1.json",
  );
  const lexicalV2RealUseReviewPath = resolve(
    repositoryRoot,
    "benchmarks/search/lexical-v2-real-use-reviewed-v1.json",
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
  const lexicalAssistedV2Source = loadJson(lexicalAssistedV2Path);
  const lexicalAssistedV2 = validateLexicalAssistedV2Suite(lexicalAssistedV2Source, repositoryRoot);
  const catalogAssistedV3Source = loadJson(catalogAssistedV3Path);
  const catalogAssistedV3 = validateCatalogAssistedV3Alignment(
    lexicalAssistedV2Source,
    catalogAssistedV3Source,
  );
  validateCatalogAssistedV3Suite(catalogAssistedV3, repositoryRoot);
  const coreTermAssistedV4 = validateCoreTermAssistedV4Alignment(
    catalogAssistedV3Source,
    loadJson(coreTermAssistedV4Path),
  );
  validateCoreTermAssistedV4Suite(coreTermAssistedV4, repositoryRoot);
  const referenceMarkerAssistedV5 = validateReferenceMarkerAssistedV5Alignment(
    loadJson(coreTermAssistedV4Path),
    loadJson(referenceMarkerAssistedV5Path),
  );
  validateReferenceMarkerAssistedV5Suite(referenceMarkerAssistedV5, repositoryRoot);
  const markerDerivedPathsV6 = validateMarkerDerivedPathsV6Suite(
    loadJson(markerDerivedPathsV6Path),
    repositoryRoot,
  );
  const stagedEvidenceV7 = validateStagedEvidenceV7Suite(
    loadJson(stagedEvidenceV7Path),
    repositoryRoot,
  );
  const linkedEvidenceReconciliationV8 = validateLinkedEvidenceReconciliationV8Suite(
    loadJson(linkedEvidenceReconciliationV8Path),
    repositoryRoot,
  );
  const linkedEvidenceReconciliationConfirmationV9 =
    validateLinkedEvidenceReconciliationConfirmationV9Suite(
      loadJson(linkedEvidenceReconciliationConfirmationV9Path),
      repositoryRoot,
    );
  const lexicalV2Provider = validateLexicalV2ProviderSuite(
    loadJson(lexicalV2ProviderPath),
    repositoryRoot,
  );
  const lexicalV2RealUseReview = validateLexicalV2RealUseReview(
    loadJson(lexicalV2RealUseReviewPath),
    repositoryRoot,
  );
  assertGroundingEvaluationPassed(groundingReport);
  return {
    ...paired,
    ...grounding,
    ...preReview,
    ...lexicalFailures,
    groundingReportId: groundingReport.reportId,
    delegatedRetrievalCaseCount: delegatedRetrieval.cases.length,
    boundedFallbackCaseCount: boundedFallback.cases.length,
    lexicalAssistedV2CaseCount: lexicalAssistedV2.cases.length,
    catalogAssistedV3CaseCount: catalogAssistedV3.cases.length,
    coreTermAssistedV4CaseCount: coreTermAssistedV4.cases.length,
    referenceMarkerAssistedV5CaseCount: referenceMarkerAssistedV5.cases.length,
    markerDerivedPathsV6CaseCount: markerDerivedPathsV6.cases.length,
    stagedEvidenceV7CaseCount: stagedEvidenceV7.cases.length,
    linkedEvidenceReconciliationV8CaseCount: linkedEvidenceReconciliationV8.cases.length,
    linkedEvidenceReconciliationConfirmationV9CaseCount:
      linkedEvidenceReconciliationConfirmationV9.cases.length,
    lexicalV2ProviderCaseCount: lexicalV2Provider.cases.length,
    lexicalV2RealUseReviewCaseCount: lexicalV2RealUseReview.cases.length,
  };
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkNaturalLanguageEvaluation(repositoryRoot);
  console.log(
    `Natural-language evaluation check passed (${result.pairCount} retrieval pairs, ${result.caseCount} grounding cases across ${result.categoryCount} categories, ${result.lexicalFailureCandidateCount} lexical failure candidates across ${result.lexicalFailureTaskTypeCount} task types, ${result.lexicalDiscoveryProbeCount} discovery probes, ${result.delegatedRetrievalCaseCount} delegated retrieval cases, ${result.boundedFallbackCaseCount} bounded fallback cases, ${result.lexicalAssistedV2CaseCount} lexical-assisted v2 cases, ${result.catalogAssistedV3CaseCount} catalog-assisted v3 cases, ${result.coreTermAssistedV4CaseCount} core-term-assisted v4 cases, ${result.referenceMarkerAssistedV5CaseCount} reference-marker-assisted v5 cases, ${result.markerDerivedPathsV6CaseCount} marker-derived v6 cases, ${result.stagedEvidenceV7CaseCount} staged-evidence v7 cases, ${result.linkedEvidenceReconciliationV8CaseCount} linked-evidence v8 cases, ${result.linkedEvidenceReconciliationConfirmationV9CaseCount} linked-evidence confirmation v9 cases, ${result.lexicalV2ProviderCaseCount} lexical-v2 provider cases, ${result.lexicalV2RealUseReviewCaseCount} approved lexical-v2 real-use cases, ${result.preReviewAttentionCount} pre-review attention items, report ${result.groundingReportId})`,
  );
}
