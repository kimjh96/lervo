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
    `Run trace: ${report.runId}`,
    `Status: ${report.status === "completed" ? "completed" : report.status === "failed" ? "failed" : "running or interrupted"}`,
    `Recorded range: ${report.firstOccurredAt} ~ ${report.lastOccurredAt}`,
    `Event source integrity: passed (${report.integrity.eventCount})`,
    "Records:",
    ...report.events.map((event) =>
      `  ${event.seq}. ${event.type} · ${event.occurredAt}\n     ${formatPayload(event.payload)}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatTracePageReport(report: TracePageReport): string {
  const first = report.events[0]!;
  const last = report.events.at(-1)!;
  const lines = [
    `Run trace page: ${report.runId}`,
    `Event range: seq ${first.seq} ~ ${last.seq} (${report.page.returnedCount})`,
    `Pinned source: ${report.integrity.eventCount} total · ${report.integrity.headHash}`,
    ...(report.filter === undefined
      ? []
      : [`Event type filter: ${report.filter.eventTypes.join(", ")}`]),
    "Records:",
    ...report.events.map((event) =>
      `  ${event.seq}. ${event.type} · ${event.occurredAt}\n     ${formatPayload(event.payload)}`),
    report.page.nextCursor === null
      ? "Next page: none"
      : `Next cursor: ${report.page.nextCursor}`,
  ];
  return `${lines.join("\n")}\n`;
}
