import {
  searchFailureReasons,
  type SearchAssessment,
  type SearchFailureReason,
  type SearchSelectionQualityReport,
  type SearchResponse,
} from "@lervo/search";

const reasonLabels: Record<SearchFailureReason, string> = {
  expected_source_missing: "기대한 원본 누락",
  insufficient_context: "맥락 부족",
  low_rank: "순위가 너무 낮음",
  no_results: "결과 없음",
  results_not_relevant: "관련 없는 결과",
};

export function formatSearchResponse(response: SearchResponse, attemptId: string): string {
  const lines = [
    `검색 시도: ${attemptId}`,
    `색인: ${response.indexId} · ${response.engine.id}-v${response.engine.version}`,
    response.hits.length === 0 ? "결과가 없습니다." : `결과 ${response.hits.length}개:`,
    ...response.hits.map((hit) =>
      `  ${hit.rank}. ${hit.source.sourceId} · ${hit.source.path ?? hit.source.kind} · 점수 ${hit.score}`),
    `평가하려면: lervo search assess ${attemptId} --outcome accepted --selected ${
      response.hits[0] === undefined ? "<source-kind>:<source-id>" :
        `${response.hits[0].source.kind}:${response.hits[0].source.sourceId}`
    }`,
  ];
  return `${lines.join("\n")}\n`;
}

export function formatSearchAssessment(assessment: SearchAssessment): string {
  return `검색 평가를 기록했습니다: ${assessment.assessmentId} · ${
    assessment.outcome === "accepted" ? "수락" : reasonLabels[assessment.failureReason!]}
`;
}

function qualityEvidenceLabel(evidenceState: SearchSelectionQualityReport["evidenceState"]): string {
  return evidenceState === "insufficient_assessment"
    ? "평가가 아직 부족함"
    : evidenceState === "failures_observed" ? "명시적으로 평가된 실패가 있음" : "평가된 실패가 없음";
}

export function formatSearchQualityReport(report: SearchSelectionQualityReport): string {
  const lines = [
    "검색 품질 관측:",
    `  전체 시도 ${report.totalAttempts} · 평가됨 ${report.assessedAttempts} · 미평가 ${report.unassessedAttempts}`,
    `  수락 ${report.acceptedAttempts} · 실패 ${report.failedAttempts}`,
    ...searchFailureReasons.map((reason) => `  ${reasonLabels[reason]}: ${report.failuresByReason[reason]}`),
    `  근거 상태: ${qualityEvidenceLabel(report.evidenceState)}`,
    "선택별 관측:",
    ...(report.selections.length === 0
      ? ["  기록된 검색 시도가 없습니다."]
      : report.selections.flatMap((selection) => [
        `  ${selection.selectionState === "implicit_baseline"
          ? "기본 lexical 선택"
          : selection.selectionState === "recorded_baseline"
            ? `rollback baseline · ${selection.selectionTransitionId}`
            : `${selection.engine.id}-v${selection.engine.version} · ${selection.selectionTransitionId}`}`,
        `    전체 ${selection.totalAttempts} · 평가 ${selection.assessedAttempts} · 수락 ${selection.acceptedAttempts}` +
          ` · 실패 ${selection.failedAttempts} · build ${selection.adapterBuildId ??
            (selection.buildEvidenceState === "legacy_unbound" ? "기존 원본에 없음" : "해당 없음")}`,
        `    근거 상태: ${qualityEvidenceLabel(selection.evidenceState)}`,
      ])),
    "  Rollout 판단: 아직 결정하지 않음",
    "  Rollback 판단: 아직 결정하지 않음",
    "  임베딩 도입 판단: 아직 결정하지 않음",
  ];
  return `${lines.join("\n")}\n`;
}
