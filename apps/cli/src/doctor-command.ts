import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createDoctorReport,
  type DoctorReport,
  type DoctorScope,
} from "@lervo/diagnostics";
import { loadProjectManifest } from "@lervo/project";

import type { CliIo, CliServices } from "./types.js";

export const doctorUsage = "  lervo doctor [--root <path>] [--scope <all|search>] [--json]";

function parseDoctorScope(value: string | undefined): DoctorScope {
  if (value === undefined || value === "all") return "all";
  if (value === "search") return value;
  throw new TypeError(`지원하지 않는 doctor 범위입니다: ${value}`);
}

function checkLabel(checkId: DoctorReport["checks"][number]["checkId"]): string {
  switch (checkId) {
    case "event_chain": return "이벤트 원본";
    case "knowledge_candidates": return "지식 후보 근거";
    case "knowledge_reviews": return "지식 검토 근거";
    case "verified_knowledge": return "검증된 지식 근거";
    case "knowledge_staleness": return "지식 노후화 근거";
    case "document_registry": return "문서 registry";
    case "document_sources": return "문서 원본 파일";
    case "skill_packages": return "스킬 패키지";
    case "skill_lock": return "스킬 해석 lock";
    case "provider_codex_runtime": return "Codex 실행 파일";
    case "provider_claude_runtime": return "Claude 실행 파일";
    case "search_engine_selection": return "검색 엔진 선택";
    case "search_rollout_policies": return "검색 rollout 정책";
    case "search_rollout_reviews": return "검색 rollout 검토";
    case "search_rollout_actions": return "검색 rollout 조치";
  }
}

function statusLabel(status: DoctorReport["checks"][number]["status"]): string {
  if (status === "healthy") return "정상";
  if (status === "unhealthy") return "문제";
  return "확인 불가";
}

export function formatDoctorReport(report: DoctorReport): string {
  const scopeLabel = report.scope === "search"
    ? "Lervo 검색 범위 진단 결과"
    : "Lervo 진단 결과";
  const lines = [
    `${scopeLabel}: ${
      report.status === "healthy"
        ? "확인한 항목 정상"
        : report.status === "unhealthy"
          ? "문제 발견"
          : "확인 불가 항목 있음"
    }`,
    ...(report.scope === "search"
      ? ["  범위 제한: 검색 항목만 확인했으며 프로젝트 전체 상태를 뜻하지 않습니다."]
      : []),
    ...report.checks.map((check) =>
      `  ${statusLabel(check.status)}  ${checkLabel(check.checkId)} (${check.observedCount}개)${
        check.version === undefined ? "" : ` · ${check.version}`
      }`),
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
  services: Pick<CliServices, "openProjectStorage" | "inspectDoctorEnvironment">,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        scope: { type: "string" },
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
  let scope: DoctorScope;
  try {
    scope = parseDoctorScope(parsed.values.scope);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${doctorUsage}\n`);
    return 1;
  }
  let storage;
  try {
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    let report: DoctorReport;
    if (scope === "search") {
      const manifest = await loadProjectManifest(repositoryRoot);
      const inspections = await services.inspectDoctorEnvironment({
        repositoryRoot,
        projectId: manifest.projectId,
        scope,
      });
      report = await createDoctorReport({
        projectId: manifest.projectId,
        inspections,
        scope,
      });
    } else {
      storage = await services.openProjectStorage(repositoryRoot);
      const inspections = await services.inspectDoctorEnvironment({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        scope,
      });
      report = await createDoctorReport({
        projectId: storage.manifest.projectId,
        events: storage.events,
        artifacts: storage.artifacts,
        inspections,
        scope,
      });
    }
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
