import type {
  SearchEvaluationExpectation,
  SearchEvaluationFailureReason,
  SearchEvaluationSourceRank,
  SearchEvaluationStatus,
} from "./evaluation-types.js";
import { searchSourceKinds, SEARCH_MAX_RESULTS, SearchError, type SearchAssessmentSource } from "./types.js";
import { SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_EVALUATION_CASE_PATTERN = /^sec_[a-f0-9]{24}$/;
export const SEARCH_EVALUATION_RESULT_PATTERN = /^ser_[a-f0-9]{24}$/;
export const SEARCH_EVALUATION_RUN_PATTERN = /^sevr_[a-f0-9]{24}$/;

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function evaluationSourceKey(source: SearchAssessmentSource): string {
  return `${source.sourceKind.length}:${source.sourceKind}${source.sourceId}`;
}

export function normalizeEvaluationSources(
  values: readonly SearchAssessmentSource[],
  code: "invalid_evaluation_case" | "invalid_evaluation_result",
): SearchAssessmentSource[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > SEARCH_MAX_RESULTS ||
    values.some((source) => !searchSourceKinds.includes(source.sourceKind) ||
      !SOURCE_ID_PATTERN.test(source.sourceId))) {
    throw new SearchError(code, "검색 평가 묶음의 기대 원본 좌표가 유효하지 않습니다.");
  }
  const unique = new Map(values.map((source) => [evaluationSourceKey(source), { ...source }]));
  if (unique.size !== values.length) {
    throw new SearchError(code, "검색 평가 묶음의 기대 원본 좌표가 중복되었습니다.");
  }
  return [...unique.values()].sort((left, right) =>
    compareText(evaluationSourceKey(left), evaluationSourceKey(right)));
}

export function assertOrderedEvaluationSources(
  values: readonly SearchAssessmentSource[],
  code: "invalid_evaluation_case" | "invalid_evaluation_result",
): void {
  const normalized = normalizeEvaluationSources(values, code);
  if (normalized.some((source, index) => evaluationSourceKey(source) !== evaluationSourceKey(values[index]!))) {
    throw new SearchError(code, "검색 평가 묶음의 기대 원본 순서가 canonical하지 않습니다.");
  }
}

interface RankedSource extends SearchAssessmentSource { rank: number }

export function measureSearchExpectation(
  expectation: SearchEvaluationExpectation,
  hits: readonly RankedSource[],
): {
  status: SearchEvaluationStatus;
  failureReason: SearchEvaluationFailureReason | null;
  expectedSourceRanks: SearchEvaluationSourceRank[];
} {
  const hitRanks = new Map(hits.map((hit) => [evaluationSourceKey(hit), hit.rank]));
  const expectedSourceRanks = expectation.sources.map((source) => ({
    ...source,
    rank: hitRanks.get(evaluationSourceKey(source)) ?? null,
  }));
  const withinRank = expectedSourceRanks.filter((source) =>
    source.rank !== null && source.rank <= expectation.maximumRank);
  const passed = expectation.matchMode === "any"
    ? withinRank.length > 0
    : withinRank.length === expectedSourceRanks.length;
  const failureReason = passed
    ? null
    : hits.length === 0
      ? "no_results"
      : expectedSourceRanks.some((source) => source.rank === null)
        ? "expected_source_missing"
        : "low_rank";
  return { status: passed ? "passed" : "failed", failureReason, expectedSourceRanks };
}
