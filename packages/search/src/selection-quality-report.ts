import { assertSearchAssessment } from "./assessment.js";
import { assertSearchAttempt } from "./attempt.js";
import { assertSearchAdapterBuildId, assertSearchEngineIdentity, sameSearchEngine } from "./evaluation-engine.js";
import { createSearchQualityReport } from "./report.js";
import { SEARCH_ENGINE, SearchError, type SearchAssessment, type SearchAttempt } from "./types.js";
import type {
  SearchSelectionQualityCoordinate,
  SearchSelectionQualityReport,
  SearchSelectionQualitySlice,
} from "./types.js";

function coordinateKey(selectionTransitionId: string | null): string {
  return selectionTransitionId ?? "baseline";
}

function assertCoordinate(coordinate: SearchSelectionQualityCoordinate): void {
  assertSearchEngineIdentity(coordinate.engine, "invalid_attempt");
  if (!["implicit_baseline", "recorded_baseline", "candidate"].includes(coordinate.selectionState) ||
    !["not_applicable", "bound", "legacy_unbound"].includes(coordinate.buildEvidenceState)) {
    throw new SearchError("invalid_attempt", "The search selection quality state is invalid.");
  }
  if (coordinate.selectionTransitionId === null) {
    if (coordinate.selectionState !== "implicit_baseline" || coordinate.adapterBuildId !== null ||
      coordinate.buildEvidenceState !== "not_applicable" || !sameSearchEngine(coordinate.engine, SEARCH_ENGINE)) {
      throw new SearchError("invalid_attempt", "The default search selection quality coordinates are invalid.");
    }
    return;
  }
  if (!/^seact_[a-f0-9]{24}$/.test(coordinate.selectionTransitionId) ||
    coordinate.selectionState === "implicit_baseline") {
    throw new SearchError("invalid_attempt", "The search selection quality transition coordinates are invalid.");
  }
  if (coordinate.selectionState === "recorded_baseline") {
    if (coordinate.adapterBuildId !== null || coordinate.buildEvidenceState !== "not_applicable" ||
      !sameSearchEngine(coordinate.engine, SEARCH_ENGINE)) {
      throw new SearchError("invalid_attempt", "The recorded baseline quality coordinates are invalid.");
    }
    return;
  }
  if (coordinate.selectionState !== "candidate" || sameSearchEngine(coordinate.engine, SEARCH_ENGINE) ||
    (coordinate.buildEvidenceState === "bound" && coordinate.adapterBuildId === null) ||
    (coordinate.buildEvidenceState === "legacy_unbound" && coordinate.adapterBuildId !== null) ||
    coordinate.buildEvidenceState === "not_applicable") {
    throw new SearchError("invalid_attempt", "The candidate search selection quality coordinates are invalid.");
  }
  if (coordinate.adapterBuildId !== null) assertSearchAdapterBuildId(coordinate.adapterBuildId, "invalid_attempt");
}

function slice(
  coordinate: SearchSelectionQualityCoordinate,
  attempts: readonly SearchAttempt[],
  assessments: readonly SearchAssessment[],
): SearchSelectionQualitySlice {
  const quality = createSearchQualityReport(attempts, assessments);
  const { schemaVersion: _schema, embeddingDecision: _embedding, ...totals } = quality;
  return { ...coordinate, ...totals };
}

export function createSearchSelectionQualityReport(input: {
  attempts: readonly SearchAttempt[];
  assessments: readonly SearchAssessment[];
  coordinates: readonly SearchSelectionQualityCoordinate[];
}): SearchSelectionQualityReport {
  const overall = createSearchQualityReport(input.attempts, input.assessments);
  const coordinates = new Map<string, SearchSelectionQualityCoordinate>();
  for (const coordinate of input.coordinates) {
    assertCoordinate(coordinate);
    const key = coordinateKey(coordinate.selectionTransitionId);
    if (coordinates.has(key)) throw new SearchError("invalid_attempt", "Search selection quality coordinates are duplicated.");
    coordinates.set(key, structuredClone(coordinate));
  }
  const attemptsByCoordinate = new Map<string, SearchAttempt[]>();
  const attemptsById = new Map<string, SearchAttempt>();
  for (const attempt of input.attempts) {
    assertSearchAttempt(attempt);
    attemptsById.set(attempt.attemptId, attempt);
    const key = coordinateKey(attempt.selectionTransitionId);
    const coordinate = coordinates.get(key);
    if (coordinate === undefined || !sameSearchEngine(attempt.engine, coordinate.engine)) {
      throw new SearchError("invalid_attempt", "A search attempt has no selection transition or engine quality coordinates.");
    }
    const selected = attemptsByCoordinate.get(key) ?? [];
    selected.push(attempt);
    attemptsByCoordinate.set(key, selected);
  }
  const assessmentByAttempt = new Map<string, SearchAssessment>();
  for (const assessment of input.assessments) {
    const attempt = attemptsById.get(assessment.attemptId);
    if (attempt === undefined) throw new SearchError("invalid_assessment", "A search assessment has no source attempt.");
    assertSearchAssessment(assessment, attempt);
    assessmentByAttempt.set(assessment.attemptId, assessment);
  }
  if (coordinates.size !== attemptsByCoordinate.size) {
    throw new SearchError("invalid_attempt", "Selection quality coordinates exist without a search attempt.");
  }
  const selections = [...attemptsByCoordinate.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, attempts]) => slice(
      coordinates.get(key)!,
      attempts,
      attempts.flatMap((attempt) => {
        const assessment = assessmentByAttempt.get(attempt.attemptId);
        return assessment === undefined ? [] : [assessment];
      }),
    ));
  const { schemaVersion: _schema, ...totals } = overall;
  return {
    schemaVersion: 2,
    ...totals,
    selections,
    rolloutDecision: "not_determined",
    rollbackDecision: "not_determined",
  };
}
