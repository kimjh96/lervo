import { assertSearchAssessment } from "./assessment.js";
import { assertSearchAttempt } from "./attempt.js";
import {
  assertOrderedEvaluationSources,
  evaluationSourceKey,
  measureSearchExpectation,
  normalizeEvaluationSources,
  SEARCH_EVALUATION_CASE_PATTERN,
} from "./evaluation-common.js";
import type { SearchEvaluationCase } from "./evaluation-types.js";
import { contentId } from "./integrity.js";
import { identifySearchQuery } from "./normalize.js";
import {
  searchFailureReasons,
  SearchError,
  type SearchAssessment,
  type SearchAssessmentSource,
  type SearchAttempt,
} from "./types.js";
import { assertTimestamp, SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

function sameQueryIdentity(evaluationCase: SearchEvaluationCase, attempt?: SearchAttempt): boolean {
  let identity;
  try {
    identity = identifySearchQuery(evaluationCase.query);
  } catch (error) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 케이스의 query가 유효하지 않습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const matchesCase = identity.queryDigest === evaluationCase.queryDigest &&
    identity.queryCharacterCount === evaluationCase.queryCharacterCount &&
    identity.queryTermCount === evaluationCase.queryTermCount;
  return matchesCase && (attempt === undefined ||
    identity.queryDigest === attempt.queryDigest &&
    identity.queryCharacterCount === attempt.queryCharacterCount &&
    identity.queryTermCount === attempt.queryTermCount);
}

function reviewedSources(assessment: SearchAssessment): SearchAssessmentSource[] {
  return assessment.expectedSources.length > 0 ? assessment.expectedSources : assessment.selectedSources;
}

export function createSearchEvaluationCase(input: {
  attempt: SearchAttempt;
  assessment: SearchAssessment;
  query: string;
  maximumRank: number;
  matchMode?: "any" | "all";
  sources?: readonly SearchAssessmentSource[];
}): SearchEvaluationCase {
  assertSearchAttempt(input.attempt);
  assertSearchAssessment(input.assessment, input.attempt);
  let identity;
  try {
    identity = identifySearchQuery(input.query);
  } catch (error) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 query가 유효하지 않습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (identity.queryDigest !== input.attempt.queryDigest ||
    identity.queryCharacterCount !== input.attempt.queryCharacterCount ||
    identity.queryTermCount !== input.attempt.queryTermCount) {
    throw new SearchError("invalid_evaluation_case", "평가 질의가 원본 검색 시도의 질의 좌표와 다릅니다.");
  }
  const reviewed = reviewedSources(input.assessment);
  if (reviewed.length === 0) {
    throw new SearchError(
      "invalid_evaluation_case",
      "평가자가 기대하거나 수락한 원본만 반복 평가의 정답으로 사용할 수 있습니다.",
    );
  }
  if (!Number.isSafeInteger(input.maximumRank) || input.maximumRank < 1 ||
    input.maximumRank > input.attempt.requestedLimit) {
    throw new SearchError(
      "invalid_evaluation_case",
      "허용 순위는 원본 검색 시도가 관측한 결과 한도를 넘을 수 없습니다.",
    );
  }
  const sources = normalizeEvaluationSources(input.sources ?? reviewed, "invalid_evaluation_case");
  const reviewedKeys = new Set([...input.assessment.expectedSources, ...input.assessment.selectedSources]
    .map(evaluationSourceKey));
  if (sources.some((source) => !reviewedKeys.has(evaluationSourceKey(source)))) {
    throw new SearchError(
      "invalid_evaluation_case",
      "평가자가 기대하거나 수락한 원본만 반복 평가의 정답으로 사용할 수 있습니다.",
    );
  }
  const expectation = {
    matchMode: input.matchMode ?? "any" as const,
    maximumRank: input.maximumRank,
    sources,
  };
  const reference = measureSearchExpectation(expectation, input.attempt.hits);
  const core = {
    projectId: input.attempt.projectId,
    query: input.query,
    ...identity,
    expectation,
    review: {
      attemptId: input.attempt.attemptId,
      assessmentId: input.assessment.assessmentId,
      assessor: input.assessment.assessor,
      assessedAt: input.assessment.assessedAt,
      outcome: input.assessment.outcome,
      failureReason: input.assessment.failureReason,
      indexId: input.attempt.indexId,
      resultSetHash: input.attempt.resultSetHash,
      referenceRequestedLimit: input.attempt.requestedLimit,
      referenceStatus: reference.status,
      referenceExpectedSourceRanks: reference.expectedSourceRanks,
    },
  };
  const evaluationCase: SearchEvaluationCase = {
    schemaVersion: 1,
    caseId: contentId("sec", core),
    ...core,
  };
  assertSearchEvaluationCase(evaluationCase, { attempt: input.attempt, assessment: input.assessment });
  return evaluationCase;
}

export function assertSearchEvaluationCase(
  evaluationCase: SearchEvaluationCase,
  evidence?: { attempt: SearchAttempt; assessment: SearchAssessment },
): void {
  if (evaluationCase.schemaVersion !== 1 || !SEARCH_EVALUATION_CASE_PATTERN.test(evaluationCase.caseId) ||
    !SOURCE_ID_PATTERN.test(evaluationCase.projectId) ||
    !SHA256_PATTERN.test(evaluationCase.queryDigest) ||
    !Number.isSafeInteger(evaluationCase.queryCharacterCount) || evaluationCase.queryCharacterCount < 1 ||
    evaluationCase.queryCharacterCount > 500 || !Number.isSafeInteger(evaluationCase.queryTermCount) ||
    evaluationCase.queryTermCount < 1 || evaluationCase.queryTermCount > 32 ||
    typeof evaluationCase.expectation !== "object" || evaluationCase.expectation === null ||
    !["any", "all"].includes(evaluationCase.expectation.matchMode) ||
    !Number.isSafeInteger(evaluationCase.expectation?.maximumRank) ||
    evaluationCase.expectation.maximumRank < 1 || evaluationCase.expectation.maximumRank > 50) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 케이스 계약이 유효하지 않습니다.");
  }
  assertOrderedEvaluationSources(evaluationCase.expectation.sources, "invalid_evaluation_case");
  if (typeof evaluationCase.review !== "object" || evaluationCase.review === null) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 케이스의 검토 원본 좌표가 없습니다.");
  }
  assertTimestamp(evaluationCase.review.assessedAt, "invalid_evaluation_case");
  if (!/^sat_[a-f0-9]{24}$/.test(evaluationCase.review.attemptId) ||
    !/^sas_[a-f0-9]{24}$/.test(evaluationCase.review.assessmentId) ||
    !["human", "verification"].includes(evaluationCase.review.assessor) ||
    !["accepted", "failed"].includes(evaluationCase.review.outcome) ||
    (evaluationCase.review.outcome === "accepted"
      ? evaluationCase.review.failureReason !== null
      : !searchFailureReasons.includes(evaluationCase.review.failureReason!)) ||
    !/^sidx_[a-f0-9]{24}$/.test(evaluationCase.review.indexId) ||
    !SHA256_PATTERN.test(evaluationCase.review.resultSetHash) ||
    !Number.isSafeInteger(evaluationCase.review.referenceRequestedLimit) ||
    evaluationCase.review.referenceRequestedLimit < evaluationCase.expectation.maximumRank ||
    evaluationCase.review.referenceRequestedLimit > 50 ||
    !["passed", "failed"].includes(evaluationCase.review.referenceStatus) ||
    !Array.isArray(evaluationCase.review.referenceExpectedSourceRanks)) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 케이스의 검토 원본 좌표가 유효하지 않습니다.");
  }
  assertOrderedEvaluationSources(
    evaluationCase.review.referenceExpectedSourceRanks,
    "invalid_evaluation_case",
  );
  const referenceRanks = evaluationCase.review.referenceExpectedSourceRanks
    .flatMap((source) => source.rank === null ? [] : [source.rank]);
  if (evaluationCase.review.referenceExpectedSourceRanks.length !== evaluationCase.expectation.sources.length ||
    new Set(referenceRanks).size !== referenceRanks.length ||
    evaluationCase.review.referenceExpectedSourceRanks.some((source, index) =>
    evaluationSourceKey(source) !== evaluationSourceKey(evaluationCase.expectation.sources[index]!) ||
    (source.rank !== null && (!Number.isSafeInteger(source.rank) || source.rank < 1 ||
      source.rank > evaluationCase.review.referenceRequestedLimit)))) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 케이스의 기준 순위가 기대 원본과 다릅니다.");
  }
  const referenceWithinRank = evaluationCase.review.referenceExpectedSourceRanks.filter((source) =>
    source.rank !== null && source.rank <= evaluationCase.expectation.maximumRank);
  const referenceStatus = evaluationCase.expectation.matchMode === "any"
    ? referenceWithinRank.length > 0 ? "passed" : "failed"
    : referenceWithinRank.length === evaluationCase.expectation.sources.length ? "passed" : "failed";
  if (referenceStatus !== evaluationCase.review.referenceStatus) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 케이스의 기준 상태가 기대 원본 순위와 다릅니다.");
  }
  if (!sameQueryIdentity(evaluationCase, evidence?.attempt)) {
    throw new SearchError("invalid_evaluation_case", "평가 질의의 digest 또는 크기 좌표가 다릅니다.");
  }
  if (evidence !== undefined) {
    assertSearchAttempt(evidence.attempt);
    assertSearchAssessment(evidence.assessment, evidence.attempt);
    const reference = measureSearchExpectation(evaluationCase.expectation, evidence.attempt.hits);
    const review = evaluationCase.review;
    if (evaluationCase.projectId !== evidence.attempt.projectId ||
      review.attemptId !== evidence.attempt.attemptId ||
      review.assessmentId !== evidence.assessment.assessmentId ||
      review.assessor !== evidence.assessment.assessor || review.assessedAt !== evidence.assessment.assessedAt ||
      review.outcome !== evidence.assessment.outcome || review.failureReason !== evidence.assessment.failureReason ||
      review.indexId !== evidence.attempt.indexId || review.resultSetHash !== evidence.attempt.resultSetHash ||
      review.referenceRequestedLimit !== evidence.attempt.requestedLimit ||
      review.referenceStatus !== reference.status ||
      JSON.stringify(review.referenceExpectedSourceRanks) !== JSON.stringify(reference.expectedSourceRanks)) {
      throw new SearchError("invalid_evaluation_case", "검색 평가 케이스가 검토한 attempt·assessment와 다릅니다.");
    }
  }
  const { schemaVersion: _schema, caseId: _id, ...core } = evaluationCase;
  if (contentId("sec", core) !== evaluationCase.caseId) {
    throw new SearchError("invalid_evaluation_case", "검색 평가 케이스 ID가 실제 내용과 다릅니다.");
  }
}
