import {
  createSearchRolloutQualitySnapshot,
  createSearchRolloutStatusPage,
  sameSearchEngine,
  verifySearchRolloutReview,
  SEARCH_ENGINE,
  type SearchCandidateReview,
  type SearchRolloutCurrentSelection,
  type SearchRolloutQualitySnapshot,
  type SearchRolloutReview,
  type SearchRolloutStatusEvidence,
  type SearchRolloutStatusPage,
} from "@lervo/search";

import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { listStoredSearchRolloutReviews } from "./rollout-review-store.js";
import {
  loadVerifiedSearchSelectionQualityEvidence,
  type VerifiedSearchSelectionQualityEvidence,
} from "./selection-quality-evidence.js";
import { SearchLocalError } from "./types.js";

function attemptEvidenceForReview(
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

function assertReviewTarget(
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

function currentSelection(
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

export async function readLocalSearchRolloutStatus(input: {
  repositoryRoot: string;
  projectId: string;
  observedAt: Date;
  limit?: number;
  cursor?: string;
}): Promise<SearchRolloutStatusPage> {
  const [qualityEvidence, reviews] = await Promise.all([
    loadVerifiedSearchSelectionQualityEvidence(input),
    listStoredSearchRolloutReviews(input.repositoryRoot),
  ]);
  const current = qualityEvidence.history.at(-1);
  const candidateReviewIds = new Set(reviews.map((review) => review.target.candidateReviewId));
  if (current?.selected.mode === "candidate") candidateReviewIds.add(current.selected.reviewId);
  const candidateReviews = new Map(await Promise.all([...candidateReviewIds].map(async (reviewId) => [
    reviewId,
    await loadStoredSearchCandidateReview(input.repositoryRoot, reviewId),
  ] as const)));
  const selection = currentSelection(qualityEvidence.history, candidateReviews);
  const activations = new Map(qualityEvidence.history.map((activation) => [activation.activationId, activation]));
  const currentSnapshots = new Map<string, SearchRolloutQualitySnapshot>();
  const statusEvidence: SearchRolloutStatusEvidence[] = [];
  for (const review of reviews) {
    if (review.projectId !== input.projectId) {
      throw new SearchLocalError("observation_invalid", "검색 rollout 검토의 project 좌표가 다릅니다.");
    }
    const candidateReview = candidateReviews.get(review.target.candidateReviewId)!;
    assertReviewTarget(review, activations.get(review.target.selectionTransitionId), candidateReview);
    verifySearchRolloutReview(
      review,
      attemptEvidenceForReview(
        review,
        qualityEvidence.attempts,
        qualityEvidence.assessments,
        new Date(review.reviewedAt),
      ),
    );
    let snapshot = currentSnapshots.get(review.target.selectionTransitionId);
    if (snapshot === undefined) {
      const currentEvidence = attemptEvidenceForReview(
        review,
        qualityEvidence.attempts,
        qualityEvidence.assessments,
      );
      snapshot = createSearchRolloutQualitySnapshot({
        projectId: input.projectId,
        target: review.target,
        attempts: currentEvidence.attempts,
        assessments: currentEvidence.assessments,
        observedThrough: input.observedAt,
      });
      currentSnapshots.set(review.target.selectionTransitionId, snapshot);
    }
    statusEvidence.push({ review, currentQualitySnapshot: snapshot });
  }
  return createSearchRolloutStatusPage({
    projectId: input.projectId,
    observedAt: input.observedAt,
    currentSelection: selection,
    evidence: statusEvidence,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}
