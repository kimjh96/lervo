import {
  assertSearchEvaluationBundle,
  SEARCH_EVALUATION_BUNDLE_ID_PATTERN,
  SEARCH_EVALUATION_SCOPE_ID_PATTERN,
} from "./evaluation-bundle.js";
import {
  SEARCH_EVALUATION_MAX_ACTIVE_CASES,
  SEARCH_EVALUATION_MAX_REPLACEMENTS,
  type SearchEvaluationBundle,
  type SearchEvaluationCoverage,
} from "./evaluation-bundle-types.js";
import { SEARCH_EVALUATION_CASE_PATTERN } from "./evaluation-common.js";
import type { SearchEvaluationCase } from "./evaluation-types.js";
import { contentId } from "./integrity.js";
import { SearchError } from "./types.js";
import { SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

const COVERAGE_ID_PATTERN = /^secov_[a-f0-9]{24}$/;

export function createSearchEvaluationCoverage(
  bundle: SearchEvaluationBundle,
  cases: readonly SearchEvaluationCase[],
): SearchEvaluationCoverage {
  assertSearchEvaluationBundle(bundle, cases);
  const activeCases = bundle.activeCaseIds.length;
  const shortfall = Math.max(0, bundle.minimumActiveCases - activeCases);
  const sampleState = shortfall === 0 ? "sufficient" as const : "insufficient" as const;
  const core = {
    projectId: bundle.projectId,
    bundleId: bundle.bundleId,
    bundleHash: bundle.bundleHash,
    scope: { ...bundle.scope },
    minimumActiveCases: bundle.minimumActiveCases,
    activeCaseIds: [...bundle.activeCaseIds],
    replacementCount: bundle.replacements.length,
    activeCases,
    shortfall,
    sampleState,
    comparisonReadiness: sampleState === "sufficient" ? "ready" as const : "insufficient_sample" as const,
    embeddingDecision: "not_determined" as const,
  };
  const coverage: SearchEvaluationCoverage = {
    schemaVersion: 1,
    coverageId: contentId("secov", core),
    ...core,
  };
  assertSearchEvaluationCoverage(coverage);
  return coverage;
}

export function assertSearchEvaluationCoverage(
  coverage: SearchEvaluationCoverage,
  bundle?: SearchEvaluationBundle,
  cases?: readonly SearchEvaluationCase[],
): void {
  if (coverage.schemaVersion !== 1 || !COVERAGE_ID_PATTERN.test(coverage.coverageId) ||
    !SOURCE_ID_PATTERN.test(coverage.projectId) || !SEARCH_EVALUATION_BUNDLE_ID_PATTERN.test(coverage.bundleId) ||
    coverage.bundleId.length > 100 ||
    !SHA256_PATTERN.test(coverage.bundleHash) || typeof coverage.scope !== "object" || coverage.scope === null ||
    !SEARCH_EVALUATION_SCOPE_ID_PATTERN.test(coverage.scope.roleId) || coverage.scope.roleId.length > 64 ||
    !SEARCH_EVALUATION_SCOPE_ID_PATTERN.test(coverage.scope.taskType) || coverage.scope.taskType.length > 64 ||
    !Number.isSafeInteger(coverage.minimumActiveCases) || coverage.minimumActiveCases < 1 ||
    coverage.minimumActiveCases > SEARCH_EVALUATION_MAX_ACTIVE_CASES ||
    !Array.isArray(coverage.activeCaseIds) || coverage.activeCaseIds.length > SEARCH_EVALUATION_MAX_ACTIVE_CASES ||
    coverage.activeCaseIds.some((caseId) => !SEARCH_EVALUATION_CASE_PATTERN.test(caseId)) ||
    new Set(coverage.activeCaseIds).size !== coverage.activeCaseIds.length ||
    coverage.activeCaseIds.some((caseId, index) => index > 0 && coverage.activeCaseIds[index - 1]! >= caseId) ||
    !Number.isSafeInteger(coverage.replacementCount) || coverage.replacementCount < 0 ||
    coverage.replacementCount > SEARCH_EVALUATION_MAX_REPLACEMENTS || !Number.isSafeInteger(coverage.activeCases) ||
    coverage.activeCases !== coverage.activeCaseIds.length || !Number.isSafeInteger(coverage.shortfall) ||
    coverage.shortfall !== Math.max(0, coverage.minimumActiveCases - coverage.activeCases) ||
    !["sufficient", "insufficient"].includes(coverage.sampleState) ||
    coverage.sampleState !== (coverage.shortfall === 0 ? "sufficient" : "insufficient") ||
    coverage.comparisonReadiness !== (coverage.sampleState === "sufficient" ? "ready" : "insufficient_sample") ||
    coverage.embeddingDecision !== "not_determined") {
    throw new SearchError("invalid_evaluation_coverage", "검색 평가 표본 충분성 계약이 유효하지 않습니다.");
  }
  if ((bundle === undefined) !== (cases === undefined)) {
    throw new SearchError("invalid_evaluation_coverage", "표본 충분성 검증에는 묶음과 case가 함께 필요합니다.");
  }
  if (bundle !== undefined && cases !== undefined) {
    const expected = createSearchEvaluationCoverage(bundle, cases);
    if (expected.coverageId !== coverage.coverageId) {
      throw new SearchError("invalid_evaluation_coverage", "검색 평가 표본 충분성이 묶음 원본과 다릅니다.");
    }
    return;
  }
  const { schemaVersion: _schema, coverageId: _id, ...core } = coverage;
  if (contentId("secov", core) !== coverage.coverageId) {
    throw new SearchError("invalid_evaluation_coverage", "검색 평가 표본 충분성 ID가 실제 내용과 다릅니다.");
  }
}
