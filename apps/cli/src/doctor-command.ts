import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createDoctorReport, type DoctorReport } from "@lervo/diagnostics";

import type { CliIo, CliServices } from "./types.js";

export const doctorUsage = "  lervo doctor [--root <path>] [--json]";

function checkLabel(checkId: DoctorReport["checks"][number]["checkId"]): string {
  return checkId === "event_chain" ? "이벤트 원본" : "지식 후보 근거";
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `Lervo 진단 결과: ${report.status === "healthy" ? "문제 없음" : "확인 필요"}`,
    ...report.checks.map((check) =>
      `  ${check.status === "passed" ? "통과" : "실패"}  ${checkLabel(check.checkId)} (${check.observedCount}개)`),
  ];
  if (report.issues.length > 0) {
    lines.push(
      "확인할 항목:",
      ...report.issues.map((item) =>
        `  ${item.code}${item.eventId === null ? "" : ` · ${item.eventId}`}: ${item.message}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runDoctorCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "openProjectStorage">,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${doctorUsage}\n`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(`${doctorUsage}\n`);
    return 0;
  }
  let storage;
  try {
    storage = await services.openProjectStorage(
      resolve(io.cwd, parsed.values.root ?? "."),
    );
    const report = await createDoctorReport({
      projectId: storage.manifest.projectId,
      events: storage.events,
      artifacts: storage.artifacts,
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatDoctorReport(report));
    return report.status === "healthy" ? 0 : 1;
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "doctor_failed";
    io.stderr(`Lervo 상태를 진단하지 못했습니다. (${code}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}
