import { assertSearchAssessment } from "./assessment.js";
import { assertSearchAttempt } from "./attempt.js";
import { SEARCH_CANDIDATE_REVIEW_PATTERN } from "./evaluation-review.js";
import { SEARCH_CANDIDATE_ID_PATTERN } from "./evaluation-engine-registry.js";
import { assertSearchAdapterBuildId, assertSearchEngineIdentity, sameSearchEngine } from "./evaluation-engine.js";
import { canonicalHash, contentId } from "./integrity.js";
import { createSearchQualityReport } from "./report.js";
import type { SearchRolloutQualitySnapshot, SearchRolloutReviewTarget } from "./rollout-review-types.js";
import {
  SEARCH_ENGINE,
  searchFailureReasons,
  SearchError,
  type SearchAssessment,
  type SearchAttempt,
} from "./types.js";
import { assertTimestamp, SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ROLLOUT_SNAPSHOT_PATTERN = /^srqs_[a-f0-9]{24}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertSearchRolloutReviewTarget(target: SearchRolloutReviewTarget): void {
  if (!/^seact_[a-f0-9]{24}$/.test(target.selectionTransitionId) ||
    !SEARCH_CANDIDATE_ID_PATTERN.test(target.candidateId) || target.candidateId.length > 64 ||
    !SEARCH_CANDIDATE_REVIEW_PATTERN.test(target.candidateReviewId)) {
    throw new SearchError("invalid_rollout_review", "The search rollout review target coordinates are invalid.");
  }
  assertSearchEngineIdentity(target.engine, "invalid_rollout_review");
  assertSearchAdapterBuildId(target.adapterBuildId, "invalid_rollout_review");
  if (sameSearchEngine(target.engine, SEARCH_ENGINE)) {
    throw new SearchError("invalid_rollout_review", "A rollout review target must be a candidate search engine bound to a build.");
  }
}

function expectedEvidenceState(snapshot: Pick<SearchRolloutQualitySnapshot, "assessedAttempts" | "failedAttempts">) {
  return snapshot.assessedAttempts === 0
    ? "insufficient_assessment" as const
    : snapshot.failedAttempts > 0 ? "failures_observed" as const : "no_failures_observed" as const;
}

export function assertSearchRolloutQualitySnapshot(snapshot: SearchRolloutQualitySnapshot): void {
  if (!SEARCH_ROLLOUT_SNAPSHOT_PATTERN.test(snapshot.snapshotId) || !SHA256_PATTERN.test(snapshot.inputDigest) ||
    !Number.isSafeInteger(snapshot.totalAttempts) || snapshot.totalAttempts < 1 ||
    !Number.isSafeInteger(snapshot.assessedAttempts) || snapshot.assessedAttempts < 0 ||
    !Number.isSafeInteger(snapshot.unassessedAttempts) || snapshot.unassessedAttempts < 0 ||
    !Number.isSafeInteger(snapshot.acceptedAttempts) || snapshot.acceptedAttempts < 0 ||
    !Number.isSafeInteger(snapshot.failedAttempts) || snapshot.failedAttempts < 0 ||
    snapshot.assessedAttempts + snapshot.unassessedAttempts !== snapshot.totalAttempts ||
    snapshot.acceptedAttempts + snapshot.failedAttempts !== snapshot.assessedAttempts ||
    snapshot.evidenceState !== expectedEvidenceState(snapshot) ||
    Object.keys(snapshot.failuresByReason).sort(compareText).join("\0") !==
      [...searchFailureReasons].sort(compareText).join("\0") ||
    searchFailureReasons.some((reason) => !Number.isSafeInteger(snapshot.failuresByReason[reason]) ||
      snapshot.failuresByReason[reason] < 0) ||
    searchFailureReasons.reduce((sum, reason) => sum + snapshot.failuresByReason[reason], 0) !==
      snapshot.failedAttempts) {
    throw new SearchError("invalid_rollout_review", "The search rollout quality snapshot is invalid.");
  }
  assertTimestamp(snapshot.observedThrough, "invalid_rollout_review");
  const { snapshotId: _id, ...core } = snapshot;
  if (contentId("srqs", core) !== snapshot.snapshotId) {
    throw new SearchError("invalid_rollout_review", "The search rollout quality snapshot ID does not match its content.");
  }
}

export function createSearchRolloutQualitySnapshot(input: {
  projectId: string;
  target: SearchRolloutReviewTarget;
  attempts: readonly SearchAttempt[];
  assessments: readonly SearchAssessment[];
  observedThrough: Date;
}): SearchRolloutQualitySnapshot {
  assertSearchRolloutReviewTarget(input.target);
  if (!SOURCE_ID_PATTERN.test(input.projectId) || !Number.isFinite(input.observedThrough.getTime()) ||
    input.attempts.length < 1 || input.attempts.length > 10_000) {
    throw new SearchError("invalid_rollout_review", "The search rollout quality snapshot input is invalid.");
  }
  const attempts = [...input.attempts].sort((left, right) => compareText(left.attemptId, right.attemptId));
  const attemptIds = new Set<string>();
  for (const attempt of attempts) {
    assertSearchAttempt(attempt);
    if (attemptIds.has(attempt.attemptId) || attempt.projectId !== input.projectId ||
      attempt.selectionTransitionId !== input.target.selectionTransitionId ||
      !sameSearchEngine(attempt.engine, input.target.engine) ||
      Date.parse(attempt.observedAt) > input.observedThrough.getTime()) {
      throw new SearchError("invalid_rollout_review", "A search rollout review attempt does not match the target selection or timestamp.");
    }
    attemptIds.add(attempt.attemptId);
  }
  const assessments = [...input.assessments].sort((left, right) => compareText(left.assessmentId, right.assessmentId));
  const attemptsById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  for (const assessment of assessments) {
    const attempt = attemptsById.get(assessment.attemptId);
    if (attempt === undefined) {
      throw new SearchError("invalid_rollout_review", "The search rollout review contains an assessment outside its target attempts.");
    }
    assertSearchAssessment(assessment, attempt);
    if (Date.parse(assessment.assessedAt) > input.observedThrough.getTime()) {
      throw new SearchError("invalid_rollout_review", "A search assessment after the review timestamp cannot be used as rollout evidence.");
    }
  }
  const quality = createSearchQualityReport(attempts, assessments);
  const core = {
    inputDigest: canonicalHash({
      attemptIds: attempts.map((attempt) => attempt.attemptId),
      assessmentIds: assessments.map((assessment) => assessment.assessmentId),
    }),
    observedThrough: input.observedThrough.toISOString(),
    totalAttempts: quality.totalAttempts,
    assessedAttempts: quality.assessedAttempts,
    unassessedAttempts: quality.unassessedAttempts,
    acceptedAttempts: quality.acceptedAttempts,
    failedAttempts: quality.failedAttempts,
    failuresByReason: { ...quality.failuresByReason },
    evidenceState: quality.evidenceState,
  };
  const snapshot: SearchRolloutQualitySnapshot = { snapshotId: contentId("srqs", core), ...core };
  assertSearchRolloutQualitySnapshot(snapshot);
  return snapshot;
}
