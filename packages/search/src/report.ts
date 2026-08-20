import { assertSearchAssessment } from "./assessment.js";
import { assertSearchAttempt } from "./attempt.js";
import {
  searchFailureReasons,
  SearchError,
  type SearchAssessment,
  type SearchAttempt,
  type SearchQualityReport,
} from "./types.js";

export function createSearchQualityReport(
  attempts: readonly SearchAttempt[],
  assessments: readonly SearchAssessment[],
): SearchQualityReport {
  const byAttempt = new Map<string, SearchAttempt>();
  const projectIds = new Set<string>();
  for (const attempt of attempts) {
    assertSearchAttempt(attempt);
    if (byAttempt.has(attempt.attemptId)) throw new SearchError("invalid_attempt", "중복 검색 시도가 있습니다.");
    byAttempt.set(attempt.attemptId, attempt);
    projectIds.add(attempt.projectId);
  }
  if (projectIds.size > 1) throw new SearchError("invalid_attempt", "서로 다른 project의 검색 시도를 합칠 수 없습니다.");
  const assessmentByAttempt = new Map<string, SearchAssessment>();
  for (const assessment of assessments) {
    const attempt = byAttempt.get(assessment.attemptId);
    if (attempt === undefined) throw new SearchError("invalid_assessment", "원본 시도 없는 검색 평가가 있습니다.");
    assertSearchAssessment(assessment, attempt);
    if (assessmentByAttempt.has(assessment.attemptId)) {
      throw new SearchError("assessment_conflict", "한 검색 시도에 여러 평가가 있습니다.");
    }
    assessmentByAttempt.set(assessment.attemptId, assessment);
  }
  const failuresByReason = Object.fromEntries(searchFailureReasons.map((reason) => [reason, 0])) as
    SearchQualityReport["failuresByReason"];
  let acceptedAttempts = 0;
  let failedAttempts = 0;
  for (const assessment of assessmentByAttempt.values()) {
    if (assessment.outcome === "accepted") acceptedAttempts += 1;
    else {
      failedAttempts += 1;
      failuresByReason[assessment.failureReason!] += 1;
    }
  }
  return {
    schemaVersion: 1,
    totalAttempts: attempts.length,
    assessedAttempts: assessmentByAttempt.size,
    unassessedAttempts: attempts.length - assessmentByAttempt.size,
    acceptedAttempts,
    failedAttempts,
    failuresByReason,
    evidenceState: assessmentByAttempt.size === 0
      ? "insufficient_assessment"
      : failedAttempts > 0 ? "failures_observed" : "no_failures_observed",
    embeddingDecision: "not_determined",
  };
}
