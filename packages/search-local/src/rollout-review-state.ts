import {
  createSearchRolloutQualitySnapshot,
  sameSearchEngine,
  verifySearchRolloutReview,
  SEARCH_ENGINE,
  type SearchCandidateReview,
  type SearchRolloutCurrentSelection,
  type SearchRolloutQualitySnapshot,
  type SearchRolloutReview,
} from "@lervo/search";

import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { loadSearchRolloutReviewPolicy } from "./rollout-policy-files.js";
import { loadStoredSearchRolloutReview } from "./rollout-review-store.js";
import {
  loadVerifiedSearchSelectionQualityEvidence,
  type VerifiedSearchSelectionQualityEvidence,
} from "./selection-quality-evidence.js";
import { SearchLocalError } from "./types.js";

export function rolloutAttemptEvidence(
  review: SearchRolloutReview,
  attempts: VerifiedSearchSelectionQualityEvidence["attempts"],
  assessments: VerifiedSearchSelectionQualityEvidence["assessments"],
  through?: Date,
) {
  const selectedAttempts = attempts.filter((attempt) =>
    attempt.selectionTransitionId === review.target.selectionTransitionId &&
    (through === undefined || Date.parse(attempt.observedAt) <= through.getTime()));
  const attemptIds = new Set(selectedAttempts.map((attempt) => attempt.attemptId));
  const selectedAssessments = assessments.filter((assessment) =>
    attemptIds.has(assessment.attemptId) &&
    (through === undefined || Date.parse(assessment.assessedAt) <= through.getTime()));
  return { attempts: selectedAttempts, assessments: selectedAssessments };
}

export function assertRolloutReviewTarget(
  review: SearchRolloutReview,
  activation: VerifiedSearchSelectionQualityEvidence["history"][number] | undefined,
  candidateReview: SearchCandidateReview,
): void {
  if (activation === undefined || activation.selected.mode !== "candidate" ||
    activation.projectId !== review.projectId || activation.selected.candidateId !== review.target.candidateId ||
    activation.selected.reviewId !== review.target.candidateReviewId ||
    !sameSearchEngine(activation.selected.engine, review.target.engine) || candidateReview.schemaVersion !== 2 ||
    candidateReview.reviewId !== review.target.candidateReviewId ||
    candidateReview.candidateAdapterBuildId !== review.target.adapterBuildId) {
    throw new SearchLocalError("observation_invalid", "검색 rollout 검토 대상이 선택·후보 검토 원본과 다릅니다.");
  }
}

export function createRolloutCurrentSelection(
  history: VerifiedSearchSelectionQualityEvidence["history"],
  candidateReviews: ReadonlyMap<string, SearchCandidateReview>,
): SearchRolloutCurrentSelection {
  const current = history.at(-1);
  if (current === undefined) {
    return {
      selectionTransitionId: null,
      selectionState: "implicit_baseline",
      candidateId: null,
      engine: { ...SEARCH_ENGINE },
      adapterBuildId: null,
      candidateReviewId: null,
      buildEvidenceState: "not_applicable",
    };
  }
  if (current.selected.mode === "baseline") {
    return {
      selectionTransitionId: current.activationId,
      selectionState: "recorded_baseline",
      candidateId: null,
      engine: { ...current.selected.engine },
      adapterBuildId: null,
      candidateReviewId: null,
      buildEvidenceState: "not_applicable",
    };
  }
  const review = candidateReviews.get(current.selected.reviewId);
  if (review === undefined) {
    throw new SearchLocalError("observation_invalid", "현재 후보 검색 검토 원본을 찾을 수 없습니다.");
  }
  return {
    selectionTransitionId: current.activationId,
    selectionState: "candidate",
    candidateId: current.selected.candidateId,
    engine: { ...current.selected.engine },
    adapterBuildId: review.schemaVersion === 2 ? review.candidateAdapterBuildId : null,
    candidateReviewId: review.reviewId,
    buildEvidenceState: review.schemaVersion === 2 ? "bound" : "legacy_unbound",
  };
}

export async function loadVerifiedLocalSearchRolloutReviewState(input: {
  repositoryRoot: string;
  projectId: string;
  rolloutReviewId: string;
  observedAt: Date;
}): Promise<{
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
  currentSelectionTransitionId: string | null;
}> {
  const [qualityEvidence, review] = await Promise.all([
    loadVerifiedSearchSelectionQualityEvidence(input),
    loadStoredSearchRolloutReview(input.repositoryRoot, input.rolloutReviewId),
  ]);
  if (review.projectId !== input.projectId) {
    throw new SearchLocalError("observation_invalid", "검색 rollout 검토의 project 좌표가 다릅니다.");
  }
  const [candidateReview, rolloutPolicy] = await Promise.all([
    loadStoredSearchCandidateReview(input.repositoryRoot, review.target.candidateReviewId),
    review.schemaVersion === 2
      ? loadSearchRolloutReviewPolicy(input.repositoryRoot, review.rolloutPolicyId)
      : Promise.resolve(null),
  ]);
  if (rolloutPolicy !== null && rolloutPolicy.projectId !== input.projectId) {
    throw new SearchLocalError("observation_invalid", "검색 rollout 검토 정책의 project 좌표가 다릅니다.");
  }
  const activation = qualityEvidence.history.find(
    (item) => item.activationId === review.target.selectionTransitionId,
  );
  assertRolloutReviewTarget(review, activation, candidateReview);
  verifySearchRolloutReview(
    review,
    rolloutAttemptEvidence(
      review,
      qualityEvidence.attempts,
      qualityEvidence.assessments,
      new Date(review.reviewedAt),
    ),
  );
  const currentEvidence = rolloutAttemptEvidence(
    review,
    qualityEvidence.attempts,
    qualityEvidence.assessments,
    input.observedAt,
  );
  const currentQualitySnapshot = createSearchRolloutQualitySnapshot({
    projectId: input.projectId,
    target: review.target,
    attempts: currentEvidence.attempts,
    assessments: currentEvidence.assessments,
    observedThrough: input.observedAt,
  });
  return {
    review,
    currentQualitySnapshot,
    currentSelectionTransitionId: qualityEvidence.history.at(-1)?.activationId ?? null,
  };
}
