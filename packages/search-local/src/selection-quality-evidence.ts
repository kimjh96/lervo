import type {
  SearchAssessment,
  SearchAttempt,
  SearchEngineActivation,
  SearchSelectionQualityCoordinate,
  SearchSelectionQualityReport,
} from "@lervo/search";
import { createSearchSelectionQualityReport } from "@lervo/search";

import { loadSearchEngineActivationHistory } from "./engine-activation-store.js";
import { verifySearchEngineSelectionHistory } from "./engine-selection-history-verifier.js";
import { loadStoredSearchCandidateReview } from "./evaluation-review-store.js";
import { LocalSearchObservationStore } from "./store.js";
import { SearchLocalError } from "./types.js";

export interface VerifiedSearchSelectionQualityEvidence {
  attempts: SearchAttempt[];
  assessments: SearchAssessment[];
  history: SearchEngineActivation[];
  coordinates: SearchSelectionQualityCoordinate[];
  report: SearchSelectionQualityReport;
}

export async function loadVerifiedSearchSelectionQualityEvidence(input: {
  repositoryRoot: string;
  projectId: string;
}): Promise<VerifiedSearchSelectionQualityEvidence> {
  const [store, history] = await Promise.all([
    LocalSearchObservationStore.openExisting(input.repositoryRoot),
    loadSearchEngineActivationHistory(input.repositoryRoot),
  ]);
  const [attempts, assessments]: [SearchAttempt[], SearchAssessment[]] =
    store === null ? [[], []] : await Promise.all([store.listAttempts(), store.listAssessments()]);
  if (
    attempts.some((attempt) => attempt.projectId !== input.projectId) ||
    assessments.some((assessment) => assessment.projectId !== input.projectId)
  ) {
    throw new SearchLocalError(
      "observation_invalid",
      "The search quality source has project coordinates that differ from the current manifest.",
    );
  }
  if (history.length > 0) {
    await verifySearchEngineSelectionHistory({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      history,
      attempts,
      assessments,
    });
  }
  const activations = new Map(history.map((activation) => [activation.activationId, activation]));
  const coordinates = new Map<string, SearchSelectionQualityCoordinate>();
  for (const attempt of attempts) {
    if (attempt.selectionTransitionId === null) {
      if (attempt.productQualificationId !== null && attempt.productQualificationId !== undefined) {
        coordinates.set(`product:${attempt.productQualificationId}`, {
          selectionTransitionId: null,
          productQualificationId: attempt.productQualificationId,
          engine: { ...attempt.engine },
          selectionState: "product_default",
          adapterBuildId: null,
          buildEvidenceState: "product_qualified",
        });
        continue;
      }
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
      throw new SearchLocalError(
        "observation_invalid",
        "The selection transition referenced by the search attempt was not found.",
      );
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
  const verifiedCoordinates = [...coordinates.values()];
  const report = createSearchSelectionQualityReport({
    attempts,
    assessments,
    coordinates: verifiedCoordinates,
  });
  return { attempts, assessments, history, coordinates: verifiedCoordinates, report };
}
