import { assertSearchAttempt, SEARCH_ATTEMPT_PATTERN } from "./attempt.js";
import { contentId } from "./integrity.js";
import {
  searchFailureReasons,
  searchSourceKinds,
  SEARCH_MAX_RESULTS,
  SearchError,
  type SearchAssessment,
  type SearchAssessmentSource,
  type SearchAttempt,
} from "./types.js";
import { assertTimestamp, SOURCE_ID_PATTERN } from "./validation.js";

const ASSESSMENT_PATTERN = /^sas_[a-f0-9]{24}$/;

function sourceKey(source: SearchAssessmentSource): string {
  return `${source.sourceKind.length}:${source.sourceKind}${source.sourceId}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validSource(value: unknown): value is SearchAssessmentSource {
  return typeof value === "object" && value !== null &&
    searchSourceKinds.includes((value as SearchAssessmentSource).sourceKind) &&
    SOURCE_ID_PATTERN.test((value as SearchAssessmentSource).sourceId);
}

function sources(values: readonly SearchAssessmentSource[]): SearchAssessmentSource[] {
  if (values.length > SEARCH_MAX_RESULTS || values.some((source) => !validSource(source))) {
    throw new SearchError("invalid_assessment", "검색 평가 source 좌표가 유효하지 않습니다.");
  }
  return [...new Map(values.map((source) => [sourceKey(source), { ...source }])).values()]
    .sort((left, right) => compareText(sourceKey(left), sourceKey(right)));
}

function validSources(value: unknown): value is SearchAssessmentSource[] {
  if (!Array.isArray(value) || value.length > SEARCH_MAX_RESULTS) return false;
  const keys: string[] = [];
  for (const source of value) {
    if (!validSource(source)) return false;
    keys.push(sourceKey(source));
  }
  return new Set(keys).size === keys.length && keys.every((key, index) => index === 0 || keys[index - 1]! < key);
}

export function createSearchAssessment(input: {
  attempt: SearchAttempt;
  assessedAt: Date;
  assessor: SearchAssessment["assessor"];
  outcome: SearchAssessment["outcome"];
  failureReason?: SearchAssessment["failureReason"];
  selectedSources?: readonly SearchAssessmentSource[];
  expectedSources?: readonly SearchAssessmentSource[];
}): SearchAssessment {
  assertSearchAttempt(input.attempt);
  const core = {
    attemptId: input.attempt.attemptId,
    projectId: input.attempt.projectId,
    assessedAt: input.assessedAt.toISOString(),
    assessor: input.assessor,
    outcome: input.outcome,
    failureReason: input.failureReason ?? null,
    selectedSources: sources(input.selectedSources ?? []),
    expectedSources: sources(input.expectedSources ?? []),
  };
  const assessment: SearchAssessment = {
    schemaVersion: 1,
    assessmentId: contentId("sas", core),
    ...core,
  };
  assertSearchAssessment(assessment, input.attempt);
  return assessment;
}

export function assertSearchAssessment(assessment: SearchAssessment, attempt?: SearchAttempt): void {
  if (assessment.schemaVersion !== 1 || !ASSESSMENT_PATTERN.test(assessment.assessmentId) ||
    !SEARCH_ATTEMPT_PATTERN.test(assessment.attemptId) || !SOURCE_ID_PATTERN.test(assessment.projectId) ||
    !["human", "verification"].includes(assessment.assessor) ||
    !["accepted", "failed"].includes(assessment.outcome) ||
    !validSources(assessment.selectedSources) || !validSources(assessment.expectedSources)) {
    throw new SearchError("invalid_assessment", "검색 평가 계약이 유효하지 않습니다.");
  }
  assertTimestamp(assessment.assessedAt, "invalid_assessment");
  if (assessment.outcome === "accepted") {
    if (assessment.failureReason !== null || assessment.selectedSources.length === 0) {
      throw new SearchError("invalid_assessment", "수락 평가에는 선택한 source가 필요합니다.");
    }
  } else if (assessment.failureReason === null || !searchFailureReasons.includes(assessment.failureReason)) {
    throw new SearchError("invalid_assessment", "실패 평가에는 controlled 실패 사유가 필요합니다.");
  }
  if (attempt !== undefined) {
    assertSearchAttempt(attempt);
    const resultSources = new Set(attempt.hits.map((hit) => sourceKey(hit)));
    if (assessment.attemptId !== attempt.attemptId || assessment.projectId !== attempt.projectId ||
      Date.parse(assessment.assessedAt) < Date.parse(attempt.observedAt) ||
      assessment.selectedSources.some((source) => !resultSources.has(sourceKey(source))) ||
      (assessment.failureReason === "no_results" && attempt.hits.length !== 0)) {
      throw new SearchError("invalid_assessment", "검색 평가가 대상 시도와 일치하지 않습니다.");
    }
  }
  const { schemaVersion: _schema, assessmentId: _id, ...core } = assessment;
  if (contentId("sas", core) !== assessment.assessmentId) {
    throw new SearchError("invalid_assessment", "검색 평가 ID가 실제 내용과 다릅니다.");
  }
}
