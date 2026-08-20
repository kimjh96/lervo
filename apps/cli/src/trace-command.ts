import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createTracePage,
  createTraceReport,
  maximumTracePageSize,
  type TracePageReport,
  type TraceReport,
} from "@lervo/diagnostics";
import { eventTypes, type EventType } from "@lervo/schemas";

import type { CliIo, CliServices } from "./types.js";

export const traceUsage =
  `  lervo trace [last|run-id] [--root <path>] [--json] [--page-size <1-${maximumTracePageSize}>] [--event-type <type>...] | --cursor <cursor>`;
const knownEventTypes = new Set<string>(eventTypes);

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

function parsePageSize(value: string): number {
  if (!/^\d+$/.test(value)) throw new RangeError("page-size는 정수여야 합니다.");
  const pageSize = Number(value);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maximumTracePageSize) {
    throw new RangeError(`page-size는 1 이상 ${maximumTracePageSize} 이하여야 합니다.`);
  }
  return pageSize;
}

export async function runTraceCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "openProjectStorage">,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        "page-size": { type: "string" },
        cursor: { type: "string" },
        "event-type": { type: "string", multiple: true },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${traceUsage}\n`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(`${traceUsage}\n`);
    return 0;
  }
  if (parsed.positionals.length > 1) {
    io.stderr(`run ID는 하나만 지정할 수 있습니다.\n${traceUsage}\n`);
    return 1;
  }
  if (parsed.values.cursor !== undefined && (
    parsed.positionals.length > 0 ||
    parsed.values["page-size"] !== undefined ||
    parsed.values["event-type"] !== undefined
  )) {
    io.stderr(`cursor는 run ID나 page-size와 함께 지정할 수 없습니다.\n${traceUsage}\n`);
    return 1;
  }
  const requestedEventTypes = parsed.values["event-type"];
  if (requestedEventTypes !== undefined && (
    new Set(requestedEventTypes).size !== requestedEventTypes.length ||
    requestedEventTypes.some((eventType) => !knownEventTypes.has(eventType))
  )) {
    io.stderr(`event-type은 지원하는 값을 중복 없이 지정해야 합니다.\n${traceUsage}\n`);
    return 1;
  }
  let storage;
  try {
    storage = await services.openProjectStorage(
      resolve(io.cwd, parsed.values.root ?? "."),
    );
    const paged = parsed.values.cursor !== undefined ||
      parsed.values["page-size"] !== undefined || requestedEventTypes !== undefined;
    const report = parsed.values.cursor !== undefined
      ? createTracePage({
          projectId: storage.manifest.projectId,
          events: storage.events,
          cursor: parsed.values.cursor,
        })
      : paged
        ? createTracePage({
            projectId: storage.manifest.projectId,
            events: storage.events,
            selector: parsed.positionals[0] ?? "last",
            ...(parsed.values["page-size"] === undefined
              ? {}
              : { limit: parsePageSize(parsed.values["page-size"]) }),
            ...(requestedEventTypes === undefined
              ? {}
              : { eventTypes: requestedEventTypes as EventType[] }),
          })
        : createTraceReport({
            projectId: storage.manifest.projectId,
            events: storage.events,
            selector: parsed.positionals[0] ?? "last",
          });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : paged
        ? formatTracePageReport(report as TracePageReport)
        : formatTraceReport(report as TraceReport));
    return 0;
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "trace_failed";
    io.stderr(`실행 기록을 조회하지 못했습니다. (${code}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}
