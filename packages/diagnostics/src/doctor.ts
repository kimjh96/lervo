import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { inspectDoctorKnowledge } from "./knowledge-doctor-inspection.js";
import { createDoctorRecoveryGuidance } from "./recovery-guidance.js";
import type {
  DoctorCheck,
  DoctorInspection,
  DoctorIssue,
  DoctorReport,
  DoctorScope,
} from "./types.js";
const inspectionCheckIdsByScope = {
  all: [
    "document_registry",
    "document_sources",
    "skill_packages",
    "skill_lock",
    "provider_codex_runtime",
    "provider_claude_runtime",
    "search_engine_selection",
    "search_rollout_policies",
    "search_rollout_reviews",
    "search_rollout_actions",
  ],
  knowledge: [],
  documents: ["document_registry", "document_sources"],
  skills: ["skill_packages", "skill_lock"],
  providers: ["provider_codex_runtime", "provider_claude_runtime"],
  search: [
    "search_engine_selection",
    "search_rollout_policies",
    "search_rollout_reviews",
    "search_rollout_actions",
  ],
} as const satisfies Record<DoctorScope, readonly DoctorCheck["checkId"][]>;

function requiredInspectionIds(scope: DoctorScope): readonly DoctorCheck["checkId"][] {
  return inspectionCheckIdsByScope[scope];
}

function assertEnvironmentInspections(
  inspections: readonly DoctorInspection[],
  scope: DoctorScope,
): void {
  const required = requiredInspectionIds(scope);
  const allowed = new Set<DoctorCheck["checkId"]>(required);
  const seen = new Set<DoctorCheck["checkId"]>();
  for (const inspection of inspections) {
    const { check, issues } = inspection;
    if (!allowed.has(check.checkId) || seen.has(check.checkId)) {
      throw new TypeError(`Doctor 환경 검사 ID가 유효하지 않습니다: ${check.checkId}`);
    }
    if (!Number.isSafeInteger(check.observedCount) || check.observedCount < 0) {
      throw new TypeError(`Doctor 관측 개수가 유효하지 않습니다: ${check.checkId}`);
    }
    if (
      (check.status === "healthy" && issues.length !== 0) ||
      (check.status !== "healthy" && issues.length === 0) ||
      (check.version !== undefined && check.status !== "healthy")
    ) {
      throw new TypeError(`Doctor 검사 상태와 근거가 일치하지 않습니다: ${check.checkId}`);
    }
    seen.add(check.checkId);
  }
  const missing = required.filter((checkId) => !seen.has(checkId));
  if (missing.length > 0) {
    throw new TypeError(`Doctor 환경 검사가 누락되었습니다: ${missing.join(", ")}`);
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
    throw new TypeError(`Doctor 검사 ID가 중복되었습니다: ${duplicateCheck.checkId}`);
  }
  issues.push(...inspections.flatMap((inspection) => inspection.issues));
  const status = checks.some((check) => check.status === "unhealthy")
    ? "unhealthy"
    : checks.some((check) => check.status === "unknown")
      ? "unknown"
      : "healthy";
  return {
    projectId: input.projectId,
    scope,
    status,
    checks,
    issues,
    recoveryGuidance: createDoctorRecoveryGuidance(issues),
  };
}
