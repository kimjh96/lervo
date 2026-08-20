import type { TracePageReport, TraceReport } from "@lervo/diagnostics";

function formatPayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([key, value]) => `${key}=${
      Array.isArray(value) ? value.join(", ") : String(value)
    }`)
    .join(" · ");
}

export function formatTraceReport(report: TraceReport): string {
  const lines = [
    `실행 추적 결과: ${report.runId}`,
    `상태: ${report.status === "completed" ? "완료" : report.status === "failed" ? "실패" : "진행 중 또는 중단"}`,
    `기록 범위: ${report.firstOccurredAt} ~ ${report.lastOccurredAt}`,
    `Event 원본 무결성: 통과 (${report.integrity.eventCount}개)`,
    "기록:",
    ...report.events.map((event) =>
      `  ${event.seq}. ${event.type} · ${event.occurredAt}\n     ${formatPayload(event.payload)}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatTracePageReport(report: TracePageReport): string {
  const first = report.events[0]!;
  const last = report.events.at(-1)!;
  const lines = [
    `실행 추적 페이지: ${report.runId}`,
    `Event 범위: seq ${first.seq} ~ ${last.seq} (${report.page.returnedCount}개)`,
    `고정한 원본: 전체 ${report.integrity.eventCount}개 · ${report.integrity.headHash}`,
    ...(report.filter === undefined
      ? []
      : [`Event type 조건: ${report.filter.eventTypes.join(", ")}`]),
    "기록:",
    ...report.events.map((event) =>
      `  ${event.seq}. ${event.type} · ${event.occurredAt}\n     ${formatPayload(event.payload)}`),
    report.page.nextCursor === null
      ? "다음 페이지: 없음"
      : `다음 cursor: ${report.page.nextCursor}`,
  ];
  return `${lines.join("\n")}\n`;
}
