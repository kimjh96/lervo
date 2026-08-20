import {
  searchFailureReasons,
  type SearchAssessment,
  type SearchFailureReason,
  type SearchQualityReport,
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
    `색인: ${response.indexId} · lexical-v1`,
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

export function formatSearchQualityReport(report: SearchQualityReport): string {
  const evidenceLabel = report.evidenceState === "insufficient_assessment"
    ? "평가가 아직 부족함"
    : report.evidenceState === "failures_observed" ? "명시적으로 평가된 실패가 있음" : "평가된 실패가 없음";
  const lines = [
    "검색 품질 관측:",
    `  전체 시도 ${report.totalAttempts} · 평가됨 ${report.assessedAttempts} · 미평가 ${report.unassessedAttempts}`,
    `  수락 ${report.acceptedAttempts} · 실패 ${report.failedAttempts}`,
    ...searchFailureReasons.map((reason) => `  ${reasonLabels[reason]}: ${report.failuresByReason[reason]}`),
    `  근거 상태: ${evidenceLabel}`,
    "  임베딩 도입 판단: 아직 결정하지 않음",
  ];
  return `${lines.join("\n")}\n`;
}
