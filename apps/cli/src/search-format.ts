import {
  searchFailureReasons,
  type SearchAssessment,
  type SearchFailureReason,
  type SearchSelectionQualityReport,
  type SearchResponse,
} from "@lervo/search";

const reasonLabels: Record<SearchFailureReason, string> = {
  expected_source_missing: "expected source missing",
  insufficient_context: "insufficient context",
  low_rank: "rank too low",
  no_results: "no results",
  results_not_relevant: "irrelevant results",
};

export function formatSearchResponse(response: SearchResponse, attemptId: string): string {
  const lines = [
    `Search attempt: ${attemptId}`,
    `Index: ${response.indexId} · ${response.engine.id}-v${response.engine.version}`,
    response.hits.length === 0 ? "No results." : `Results (${response.hits.length}):`,
    ...response.hits.map(
      (hit) =>
        `  ${hit.rank}. ${hit.source.sourceId} · ${hit.source.path ?? hit.source.kind} · score ${hit.score}`,
    ),
    `To assess: lervo search assess ${attemptId} --outcome accepted --selected ${
      response.hits[0] === undefined
        ? "<source-kind>:<source-id>"
        : `${response.hits[0].source.kind}:${response.hits[0].source.sourceId}`
    }`,
  ];
  return `${lines.join("\n")}\n`;
}

export function formatSearchAssessment(assessment: SearchAssessment): string {
  return `Search assessment recorded: ${assessment.assessmentId} · ${
    assessment.outcome === "accepted" ? "accepted" : reasonLabels[assessment.failureReason!]
  }
`;
}

function qualityEvidenceLabel(
  evidenceState: SearchSelectionQualityReport["evidenceState"],
): string {
  return evidenceState === "insufficient_assessment"
    ? "insufficient assessments"
    : evidenceState === "failures_observed"
      ? "explicitly assessed failures observed"
      : "no assessed failures";
}

export function formatSearchQualityReport(report: SearchSelectionQualityReport): string {
  const lines = [
    "Search quality observation:",
    `  Total attempts ${report.totalAttempts} · assessed ${report.assessedAttempts} · unassessed ${report.unassessedAttempts}`,
    `  Accepted ${report.acceptedAttempts} · failed ${report.failedAttempts}`,
    ...searchFailureReasons.map(
      (reason) => `  ${reasonLabels[reason]}: ${report.failuresByReason[reason]}`,
    ),
    `  Evidence state: ${qualityEvidenceLabel(report.evidenceState)}`,
    "Observations by selection:",
    ...(report.selections.length === 0
      ? ["  No search attempts are recorded."]
      : report.selections.flatMap((selection) => [
          `  ${
            selection.selectionState === "implicit_baseline"
              ? "default lexical selection"
              : selection.selectionState === "recorded_baseline"
                ? `rollback baseline · ${selection.selectionTransitionId}`
                : selection.selectionState === "product_default"
                  ? `${selection.engine.id}-v${selection.engine.version} product default · ${selection.productQualificationId}`
                  : `${selection.engine.id}-v${selection.engine.version} · ${selection.selectionTransitionId}`
          }`,
          `    Total ${selection.totalAttempts} · assessed ${selection.assessedAttempts} · accepted ${selection.acceptedAttempts}` +
            ` · failed ${selection.failedAttempts} · build ${
              selection.adapterBuildId ??
              (selection.buildEvidenceState === "legacy_unbound"
                ? "absent from legacy source"
                : selection.buildEvidenceState === "product_qualified"
                  ? "product qualified"
                  : "not applicable")
            }`,
          `    Evidence state: ${qualityEvidenceLabel(selection.evidenceState)}`,
        ])),
    "  Rollout decision: not decided",
    "  Rollback decision: not decided",
    "  Embedding adoption decision: not decided",
  ];
  return `${lines.join("\n")}\n`;
}
