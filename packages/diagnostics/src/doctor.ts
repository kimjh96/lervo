import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { inspectCandidate } from "./candidate-inspection.js";
import { inspectKnowledgeReview } from "./review-inspection.js";
import { inspectKnowledgeStaleness } from "./staleness-inspection.js";
import type {
  DoctorCheck,
  DoctorInspection,
  DoctorIssue,
  DoctorReport,
  DoctorScope,
} from "./types.js";
import { inspectVerifiedKnowledge } from "./verified-inspection.js";

const environmentCheckIds = [
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
] as const satisfies readonly DoctorCheck["checkId"][];

const searchCheckIds = [
  "search_engine_selection",
  "search_rollout_policies",
  "search_rollout_reviews",
  "search_rollout_actions",
] as const satisfies readonly DoctorCheck["checkId"][];

function requiredInspectionIds(scope: DoctorScope): readonly DoctorCheck["checkId"][] {
  return scope === "search" ? searchCheckIds : environmentCheckIds;
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
  | { scope: "search" }
  | { scope?: "all"; events: EventStore; artifacts: ArtifactStore }
);

export async function createDoctorReport(input: CreateDoctorReportInput): Promise<DoctorReport> {
  const scope = input.scope ?? "all";
  assertEnvironmentInspections(input.inspections, scope);
  const issues: DoctorIssue[] = [];
  const localChecks: DoctorReport["checks"] = [];
  if (input.scope !== "search") {
    let eventCount = 0;
    try {
      eventCount = input.events.verifyIntegrity().eventCount;
    } catch {
      issues.push({
        code: "event_chain_invalid",
        eventId: null,
        message: "로컬 event hash chain이 유효하지 않습니다.",
      });
    }
    const events = input.events.list();
    const candidateEvents = events.filter((event) => event.type === "knowledge.candidate.created");
    const candidateIssues = await Promise.all(candidateEvents.map((event) =>
      inspectCandidate({ event, events, artifacts: input.artifacts })));
    issues.push(...candidateIssues.flat());
    const reviewEvents = events.filter((event) => event.type === "knowledge.candidate.reviewed");
    const reviewIssues = await Promise.all(reviewEvents.map((event) =>
      inspectKnowledgeReview({ event, events, artifacts: input.artifacts })));
    issues.push(...reviewIssues.flat());
    const verifiedEvents = events.filter((event) => event.type === "knowledge.verified");
    const verifiedIssues = await Promise.all(verifiedEvents.map((event) =>
      inspectVerifiedKnowledge({ event, events, artifacts: input.artifacts })));
    issues.push(...verifiedIssues.flat());
    const stalenessEvents = events.filter((event) => event.type === "knowledge.stale.detected");
    const stalenessIssues = await Promise.all(stalenessEvents.map((event) =>
      inspectKnowledgeStaleness({ event, events, artifacts: input.artifacts })));
    issues.push(...stalenessIssues.flat());
    localChecks.push(
      {
        checkId: "event_chain",
        status: issues.some((item) => item.code === "event_chain_invalid")
          ? "unhealthy"
          : "healthy",
        observedCount: eventCount,
      },
      {
        checkId: "knowledge_candidates",
        status: candidateIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: candidateEvents.length,
      },
      {
        checkId: "knowledge_reviews",
        status: reviewIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: reviewEvents.length,
      },
      {
        checkId: "verified_knowledge",
        status: verifiedIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: verifiedEvents.length,
      },
      {
        checkId: "knowledge_staleness",
        status: stalenessIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: stalenessEvents.length,
      },
    );
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
  };
}
