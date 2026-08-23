import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import {
  doctorReportSchemaVersion,
  readDoctorReport,
} from "./doctor-report-contract.js";
import { environmentDoctorCheckIdsForScope } from "./doctor-scope-contract.js";
import { inspectDoctorKnowledge } from "./knowledge-doctor-inspection.js";
import { createDoctorRecoveryGuidance } from "./recovery-guidance.js";
import type {
  DoctorCheck,
  DoctorInspection,
  DoctorIssue,
  DoctorReport,
  DoctorScope,
} from "./types.js";

function assertEnvironmentInspections(
  inspections: readonly DoctorInspection[],
  scope: DoctorScope,
): void {
  const required = environmentDoctorCheckIdsForScope(scope);
  const allowed = new Set<DoctorCheck["checkId"]>(required);
  const seen = new Set<DoctorCheck["checkId"]>();
  for (const inspection of inspections) {
    const { check, issues } = inspection;
    if (!allowed.has(check.checkId) || seen.has(check.checkId)) {
      throw new TypeError(`Doctor environment check ID is invalid: ${check.checkId}`);
    }
    if (!Number.isSafeInteger(check.observedCount) || check.observedCount < 0) {
      throw new TypeError(`Doctor observation count is invalid: ${check.checkId}`);
    }
    if (
      (check.status === "healthy" && issues.length !== 0) ||
      (check.status !== "healthy" && issues.length === 0) ||
      (check.version !== undefined && check.status !== "healthy")
    ) {
      throw new TypeError(`Doctor check status and evidence do not agree: ${check.checkId}`);
    }
    seen.add(check.checkId);
  }
  const missing = required.filter((checkId) => !seen.has(checkId));
  if (missing.length > 0) {
    throw new TypeError(`Doctor environment checks are missing: ${missing.join(", ")}`);
  }
}

type CreateDoctorReportInput = {
  projectId: string;
  inspections: readonly DoctorInspection[];
} & (
  | { scope?: "all" | "knowledge"; events: EventStore; artifacts: ArtifactStore }
  | { scope: "documents" | "skills" | "providers" | "search" }
);

export async function createDoctorReport(input: CreateDoctorReportInput): Promise<DoctorReport> {
  const scope = input.scope ?? "all";
  assertEnvironmentInspections(input.inspections, scope);
  const issues: DoctorIssue[] = [];
  const localChecks: DoctorReport["checks"] = [];
  if (input.scope === undefined || input.scope === "all" || input.scope === "knowledge") {
    const knowledge = await inspectDoctorKnowledge(input);
    localChecks.push(...knowledge.checks);
    issues.push(...knowledge.issues);
  }
  const inspections = input.inspections;
  const checks = [...localChecks, ...inspections.map((inspection) => inspection.check)];
  const duplicateCheck = checks.find((check, index) =>
    checks.findIndex((candidate) => candidate.checkId === check.checkId) !== index);
  if (duplicateCheck !== undefined) {
    throw new TypeError(`Doctor check ID is duplicated: ${duplicateCheck.checkId}`);
  }
  issues.push(...inspections.flatMap((inspection) => inspection.issues));
  const status = checks.some((check) => check.status === "unhealthy")
    ? "unhealthy"
    : checks.some((check) => check.status === "unknown")
      ? "unknown"
      : "healthy";
  return readDoctorReport({
    schemaVersion: doctorReportSchemaVersion,
    projectId: input.projectId,
    scope,
    status,
    checks,
    issues,
    recoveryGuidance: createDoctorRecoveryGuidance(issues),
  });
}
