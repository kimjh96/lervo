import {
  createSearchSelectionQualityReport,
  type SearchSelectionQualityCoordinate,
  type SearchSelectionQualityReport,
} from "@lervo/search";

import { loadSearchEngineActivationHistory } from "./engine-activation-store.js";
import { verifySearchEngineSelectionHistory } from "./engine-selection-history-verifier.js";
import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { LocalSearchObservationStore } from "./store.js";
import { SearchLocalError } from "./types.js";

export async function createLocalSearchSelectionQualityReport(input: {
  repositoryRoot: string;
  projectId: string;
}): Promise<SearchSelectionQualityReport> {
  const [store, history] = await Promise.all([
    LocalSearchObservationStore.openExisting(input.repositoryRoot),
    loadSearchEngineActivationHistory(input.repositoryRoot),
  ]);
  const [attempts, assessments] = store === null
    ? [[], []] as const
    : await Promise.all([store.listAttempts(), store.listAssessments()]);
  if (attempts.some((attempt) => attempt.projectId !== input.projectId) ||
    assessments.some((assessment) => assessment.projectId !== input.projectId)) {
    throw new SearchLocalError("observation_invalid", "검색 품질 원본의 project 좌표가 현재 manifest와 다릅니다.");
  }
  if (history.length > 0) {
    await verifySearchEngineSelectionHistory({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      history,
    });
  }
  const activations = new Map(history.map((activation) => [activation.activationId, activation]));
  const coordinates = new Map<string, SearchSelectionQualityCoordinate>();
  for (const attempt of attempts) {
    if (attempt.selectionTransitionId === null) {
      coordinates.set("baseline", {
        selectionTransitionId: null,
        engine: { ...attempt.engine },
        selectionState: "implicit_baseline",
        adapterBuildId: null,
        buildEvidenceState: "not_applicable",
      });
      continue;
    }
    if (coordinates.has(attempt.selectionTransitionId)) continue;
    const activation = activations.get(attempt.selectionTransitionId);
    if (activation === undefined) {
      throw new SearchLocalError("observation_invalid", "검색 시도가 가리키는 선택 전이를 찾을 수 없습니다.");
    }
    const selection = activation.selected;
    if (selection.mode === "baseline") {
      coordinates.set(activation.activationId, {
        selectionTransitionId: activation.activationId,
        engine: { ...selection.engine },
        selectionState: "recorded_baseline",
        adapterBuildId: null,
        buildEvidenceState: "not_applicable",
      });
      continue;
    }
    const review = await loadStoredSearchCandidateReview(input.repositoryRoot, selection.reviewId);
    coordinates.set(activation.activationId, {
      selectionTransitionId: activation.activationId,
      engine: { ...selection.engine },
      selectionState: "candidate",
      adapterBuildId: review.schemaVersion === 2 ? review.candidateAdapterBuildId : null,
      buildEvidenceState: review.schemaVersion === 2 ? "bound" : "legacy_unbound",
    });
  }
  return createSearchSelectionQualityReport({
    attempts,
    assessments,
    coordinates: [...coordinates.values()],
  });
}
