import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createDoctorReport, type DoctorReport, type DoctorScope } from "@lervo/diagnostics";
import { loadProjectManifest } from "@lervo/project";

import {
  doctorScopeLabel,
  doctorScopeUsesProjectStorage,
  doctorScopeValues,
  parseDoctorScope,
} from "./doctor-scope.js";
import type { CliIo, CliServices } from "./types.js";
import {
  formatDeliberationInspection,
  inspectManagedDeliberation,
} from "./deliberation-inspection.js";

export const doctorUsage =
  `  lervo doctor [--root <path>] [--scope <${doctorScopeValues.join("|")}>] [--json]\n` +
  "  lervo doctor --deliberation <deliberation-id> [--root <path>] [--json]";

function checkLabel(checkId: DoctorReport["checks"][number]["checkId"]): string {
  switch (checkId) {
    case "event_chain":
      return "event source";
    case "knowledge_candidates":
      return "knowledge candidate evidence";
    case "knowledge_reviews":
      return "knowledge review evidence";
    case "verified_knowledge":
      return "verified knowledge evidence";
    case "knowledge_staleness":
      return "knowledge staleness evidence";
    case "document_registry":
      return "document registry";
    case "document_sources":
      return "document source files";
    case "skill_packages":
      return "skill packages";
    case "skill_lock":
      return "skill resolution lock";
    case "provider_codex_runtime":
      return "Codex executable";
    case "provider_claude_runtime":
      return "Claude executable";
    case "search_engine_selection":
      return "search engine selection";
    case "search_rollout_policies":
      return "search rollout policies";
    case "search_rollout_reviews":
      return "search rollout reviews";
    case "search_rollout_actions":
      return "search rollout actions";
  }
}

function statusLabel(status: DoctorReport["checks"][number]["status"]): string {
  if (status === "healthy") return "healthy";
  if (status === "unhealthy") return "unhealthy";
  return "unknown";
}

export function formatDoctorReport(report: DoctorReport): string {
  const limitedScopeLabel = doctorScopeLabel(report.scope);
  const reportLabel =
    report.scope === "all"
      ? "Lervo diagnostic report"
      : `Lervo ${limitedScopeLabel} diagnostic report`;
  const lines = [
    `${reportLabel}: ${
      report.status === "healthy"
        ? "checked items are healthy"
        : report.status === "unhealthy"
          ? "issues found"
          : "some items could not be determined"
    }`,
    ...(report.scope !== "all"
      ? [
          `  Limited scope: only ${limitedScopeLabel} items were checked; this is not the overall project status.`,
        ]
      : []),
    ...report.checks.map(
      (check) =>
        `  ${statusLabel(check.status)}  ${checkLabel(check.checkId)} (${check.observedCount})${
          check.version === undefined ? "" : ` · ${check.version}`
        }`,
    ),
  ];
  if (report.issues.length > 0) {
    lines.push(
      "Items to review:",
      ...report.issues.map(
        (item) =>
          `  ${item.code}${item.eventId === null ? "" : ` · ${item.eventId}`}: ${item.message}`,
      ),
    );
  }
  if (report.recoveryGuidance.length > 0) {
    lines.push(
      "Next checks:",
      ...report.recoveryGuidance.map((item) => `  ${item.actionCode}: ${item.message}`),
      "  No automatic fixes or state changes were performed.",
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
        deliberation: { type: "string" },
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
  if (parsed.values.deliberation !== undefined && parsed.values.scope !== undefined) {
    io.stderr(`deliberation and scope cannot be specified together.\n${doctorUsage}\n`);
    return 1;
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
    if (parsed.values.deliberation !== undefined) {
      storage = await services.openProjectStorage(repositoryRoot);
      const inspection = await inspectManagedDeliberation({
        storage,
        deliberationId: parsed.values.deliberation,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(inspection, null, 2)}\n`
          : formatDeliberationInspection(inspection),
      );
      return inspection.sourceStatus === "consistent" ? 0 : 1;
    }
    let report: DoctorReport;
    if (!doctorScopeUsesProjectStorage(scope)) {
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
      const inspections =
        scope === "knowledge"
          ? []
          : await services.inspectDoctorEnvironment({
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
    io.stdout(
      parsed.values.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report),
    );
    return report.status === "healthy" ? 0 : 1;
  } catch (error) {
    const code =
      typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : "doctor_failed";
    io.stderr(
      `Could not diagnose Lervo state. (${code}) ${
        error instanceof Error ? error.message : "Unknown error."
      }\n`,
    );
    return 1;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}
