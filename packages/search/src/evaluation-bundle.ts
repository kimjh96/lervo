import {
  SEARCH_EVALUATION_MAX_ACTIVE_CASES,
  SEARCH_EVALUATION_MAX_REPLACEMENTS,
  type SearchEvaluationBundle,
  type SearchEvaluationCaseReplacement,
} from "./evaluation-bundle-types.js";
import { SEARCH_EVALUATION_CASE_PATTERN, compareText } from "./evaluation-common.js";
import type { SearchEvaluationCase } from "./evaluation-types.js";
import { assertSearchEvaluationCase } from "./evaluation-case.js";
import { canonicalHash } from "./integrity.js";
import { SearchError } from "./types.js";
import { SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_EVALUATION_BUNDLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;
export const SEARCH_EVALUATION_SCOPE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;

function replacementKey(replacement: SearchEvaluationCaseReplacement): string {
  return `${replacement.replacedCaseId}:${replacement.replacementCaseId}`;
}

function normalizeCaseIds(caseIds: readonly string[]): string[] {
  if (!Array.isArray(caseIds) || caseIds.length > SEARCH_EVALUATION_MAX_ACTIVE_CASES ||
    caseIds.some((caseId) => !SEARCH_EVALUATION_CASE_PATTERN.test(caseId))) {
    throw new SearchError("invalid_evaluation_bundle", "검색 평가 묶음의 활성 case ID가 유효하지 않습니다.");
  }
  const sorted = [...new Set(caseIds)].sort(compareText);
  if (sorted.length !== caseIds.length) {
    throw new SearchError("invalid_evaluation_bundle", "검색 평가 묶음의 활성 case ID가 중복되었습니다.");
  }
  return sorted;
}

function normalizeReplacements(
  replacements: readonly SearchEvaluationCaseReplacement[],
): SearchEvaluationCaseReplacement[] {
  if (!Array.isArray(replacements) || replacements.length > SEARCH_EVALUATION_MAX_REPLACEMENTS ||
    replacements.some((item) => !SEARCH_EVALUATION_CASE_PATTERN.test(item.replacedCaseId) ||
      !SEARCH_EVALUATION_CASE_PATTERN.test(item.replacementCaseId) ||
      item.replacedCaseId === item.replacementCaseId)) {
    throw new SearchError("invalid_evaluation_bundle", "검색 평가 묶음의 대체 관계가 유효하지 않습니다.");
  }
  const sorted = replacements.map((item) => ({ ...item })).sort((left, right) =>
    compareText(replacementKey(left), replacementKey(right)));
  if (new Set(sorted.map((item) => item.replacedCaseId)).size !== sorted.length) {
    throw new SearchError("invalid_evaluation_bundle", "하나의 검색 평가 케이스에 대체 대상을 여러 개 지정할 수 없습니다.");
  }
  return sorted;
}

function assertReplacementGraph(bundle: SearchEvaluationBundle): void {
  const active = new Set(bundle.activeCaseIds);
  const successors = new Map(bundle.replacements.map((item) => [item.replacedCaseId, item.replacementCaseId]));
  if (bundle.replacements.some((item) => active.has(item.replacedCaseId) ||
    (!active.has(item.replacementCaseId) && !successors.has(item.replacementCaseId)))) {
    throw new SearchError(
      "invalid_evaluation_bundle",
      "대체된 case는 활성일 수 없고 모든 대체 관계는 최종 활성 case로 이어져야 합니다.",
    );
  }
  for (const start of successors.keys()) {
    const visited = new Set<string>();
    let current = start;
    while (successors.has(current)) {
      if (visited.has(current)) {
        throw new SearchError("invalid_evaluation_bundle", "검색 평가 케이스 대체 관계에 순환이 있습니다.");
      }
      visited.add(current);
      current = successors.get(current)!;
    }
    if (!active.has(current)) {
      throw new SearchError("invalid_evaluation_bundle", "검색 평가 케이스 대체 관계가 활성 case로 끝나지 않습니다.");
    }
  }
}

export function createSearchEvaluationBundle(input: {
  bundleId: string;
  projectId: string;
  roleId: string;
  taskType: string;
  minimumActiveCases: number;
  activeCaseIds: readonly string[];
  replacements?: readonly SearchEvaluationCaseReplacement[];
}): SearchEvaluationBundle {
  const core = {
    projectId: input.projectId,
    scope: { roleId: input.roleId, taskType: input.taskType },
    minimumActiveCases: input.minimumActiveCases,
    activeCaseIds: normalizeCaseIds(input.activeCaseIds),
    replacements: normalizeReplacements(input.replacements ?? []),
  };
  const bundle: SearchEvaluationBundle = {
    schemaVersion: 1,
    bundleId: input.bundleId,
    bundleHash: canonicalHash({ bundleId: input.bundleId, ...core }),
    ...core,
  };
  assertSearchEvaluationBundle(bundle);
  return bundle;
}

export function assertSearchEvaluationBundle(
  bundle: SearchEvaluationBundle,
  cases?: readonly SearchEvaluationCase[],
): void {
  if (bundle.schemaVersion !== 1 || !SEARCH_EVALUATION_BUNDLE_ID_PATTERN.test(bundle.bundleId) ||
    bundle.bundleId.length > 100 || !SHA256_PATTERN.test(bundle.bundleHash) ||
    !SOURCE_ID_PATTERN.test(bundle.projectId) || typeof bundle.scope !== "object" || bundle.scope === null ||
    !SEARCH_EVALUATION_SCOPE_ID_PATTERN.test(bundle.scope.roleId) || bundle.scope.roleId.length > 64 ||
    !SEARCH_EVALUATION_SCOPE_ID_PATTERN.test(bundle.scope.taskType) || bundle.scope.taskType.length > 64 ||
    !Number.isSafeInteger(bundle.minimumActiveCases) || bundle.minimumActiveCases < 1 ||
    bundle.minimumActiveCases > SEARCH_EVALUATION_MAX_ACTIVE_CASES) {
    throw new SearchError("invalid_evaluation_bundle", "검색 평가 묶음 계약이 유효하지 않습니다.");
  }
  const activeCaseIds = normalizeCaseIds(bundle.activeCaseIds);
  const replacements = normalizeReplacements(bundle.replacements);
  if (activeCaseIds.some((caseId, index) => caseId !== bundle.activeCaseIds[index]) ||
    replacements.some((item, index) => replacementKey(item) !== replacementKey(bundle.replacements[index]!))) {
    throw new SearchError("invalid_evaluation_bundle", "검색 평가 묶음의 case와 대체 관계 순서가 canonical하지 않습니다.");
  }
  assertReplacementGraph(bundle);
  const { schemaVersion: _schema, bundleHash: _hash, ...core } = bundle;
  if (canonicalHash(core) !== bundle.bundleHash) {
    throw new SearchError("invalid_evaluation_bundle", "검색 평가 묶음 hash가 실제 내용과 다릅니다.");
  }
  if (cases !== undefined) {
    const byId = new Map(cases.map((evaluationCase) => [evaluationCase.caseId, evaluationCase]));
    if (byId.size !== cases.length) {
      throw new SearchError("invalid_evaluation_bundle", "검증에 사용한 검색 평가 case ID가 중복되었습니다.");
    }
    const referencedIds = new Set([
      ...bundle.activeCaseIds,
      ...bundle.replacements.flatMap((item) => [item.replacedCaseId, item.replacementCaseId]),
    ]);
    if (referencedIds.size !== [...referencedIds].filter((caseId) => byId.has(caseId)).length ||
      [...referencedIds].some((caseId) => byId.get(caseId)!.projectId !== bundle.projectId)) {
      throw new SearchError("invalid_evaluation_bundle", "검색 평가 묶음이 없거나 다른 project의 case를 참조합니다.");
    }
    for (const caseId of referencedIds) assertSearchEvaluationCase(byId.get(caseId)!);
    const activeQueryDigests = bundle.activeCaseIds.map((caseId) => byId.get(caseId)!.queryDigest);
    if (new Set(activeQueryDigests).size !== activeQueryDigests.length) {
      throw new SearchError("invalid_evaluation_bundle", "같은 검색 query를 활성 표본으로 중복 계산할 수 없습니다.");
    }
  }
}
