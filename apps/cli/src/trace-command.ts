import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createTraceReport, type TraceReport } from "@lervo/diagnostics";

import type { CliIo, CliServices } from "./types.js";

export const traceUsage =
  "  lervo trace [last|run-id] [--root <path>] [--json]";

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
  let storage;
  try {
    storage = await services.openProjectStorage(
      resolve(io.cwd, parsed.values.root ?? "."),
    );
    const report = createTraceReport({
      projectId: storage.manifest.projectId,
      events: storage.events,
      selector: parsed.positionals[0] ?? "last",
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatTraceReport(report));
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
