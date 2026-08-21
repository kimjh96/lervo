import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";

import {
  DeliberationCheckpointError,
  readApprovedDeliberationCheckpoint,
  type ApprovedDeliberationCheckpoint,
} from "./deliberation-checkpoint.js";
import { inspectDeliberationLease } from "./deliberation-lease.js";

export const maximumDeliberationTraceEvents = 1_000;

export interface DeliberationInspectionReport {
  schemaVersion: 1;
  projectId: string;
  deliberationId: string;
  sourceStatus: "consistent" | "incomplete" | "inconsistent";
  phase: "rounds" | "running_after_approval" | "interrupted_after_approval" | "completed";
  completionStatus: "converged" | "no_consensus" | "failed" | null;
  artifactCount: number;
  lastRound: number | null;
  checkpoint: "missing" | "readable" | "invalid";
  lease: "missing" | "active" | "stale";
  resume: "not_available" | "blocked_running" | "candidate" | "completed";
  issues: Array<{
    code: "deliberation_history_incomplete" | "deliberation_history_invalid" |
      "deliberation_checkpoint_invalid";
    message: string;
  }>;
  events: EventEnvelope[];
}

function allEvents(storage: ProjectStorage): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const page = storage.events.list({ afterSeq, limit: 1_000 });
    events.push(...page);
    if (page.length < 1_000) return events;
    const next = page.at(-1)!.seq;
    if (next <= afterSeq) throw new Error("숙의 진단 event cursor가 전진하지 않습니다.");
    afterSeq = next;
  }
}

export async function inspectManagedDeliberation(input: {
  storage: ProjectStorage;
  deliberationId: string;
}): Promise<DeliberationInspectionReport> {
  if (!/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.deliberationId)) {
    throw new TypeError("진단할 숙의 ID가 유효하지 않습니다.");
  }
  input.storage.events.verifyIntegrity();
  const events = allEvents(input.storage);
  const started = events.filter((event) => event.type === "deliberation.started" &&
    event.payload.deliberationId === input.deliberationId);
  const artifacts = events.filter((event) => event.type === "deliberation.artifact.recorded" &&
    event.payload.deliberationId === input.deliberationId);
  const completed = events.filter((event) => event.type === "deliberation.completed" &&
    event.payload.deliberationId === input.deliberationId);
  if (started.length === 0 && artifacts.length === 0 && completed.length === 0) {
    throw Object.assign(new Error("요청한 숙의 ID의 event가 없습니다."), {
      code: "deliberation_not_found",
    });
  }
  let checkpoint: DeliberationInspectionReport["checkpoint"] = "missing";
  let checkpointValue: ApprovedDeliberationCheckpoint | null = null;
  try {
    checkpointValue = await readApprovedDeliberationCheckpoint({
      stateRoot: input.storage.paths.state,
      deliberationId: input.deliberationId,
    });
    checkpoint = "readable";
  } catch (error) {
    if (!(error instanceof DeliberationCheckpointError) ||
      error.code !== "deliberation_checkpoint_not_found") checkpoint = "invalid";
  }
  const checkpointEventIds = checkpointValue === null ? [] : [
    checkpointValue.runtime.startedEventId,
    ...checkpointValue.runtime.recordedEvents.map((item) => item.eventId),
    ...checkpointValue.runtime.publications.map((item) => item.eventId),
    ...checkpointValue.runtime.handoffs.map((item) => item.eventId),
    ...checkpointValue.runtime.artifacts.flatMap((artifact) => artifact.evidenceEventIds),
  ];
  const checkpointEventIdSet = new Set(checkpointEventIds);
  const relatedRunIds = new Set([
    ...started.map((event) => event.runId),
    ...artifacts.map((event) => event.runId),
    ...completed.map((event) => event.runId),
    ...checkpointValue?.runtime.artifacts.map((artifact) => artifact.producer.runId) ?? [],
    ...events.filter((event) => checkpointEventIdSet.has(event.eventId)).map((event) => event.runId),
  ]);
  const traceEvents = events.filter((event) => relatedRunIds.has(event.runId));
  if (traceEvents.length > maximumDeliberationTraceEvents) {
    throw Object.assign(new Error("숙의 추적 event가 1,000개를 넘었습니다."), {
      code: "deliberation_trace_too_large",
    });
  }
  let lease: DeliberationInspectionReport["lease"] = "missing";
  try {
    lease = await inspectDeliberationLease({
      stateRoot: input.storage.paths.state,
      deliberationId: input.deliberationId,
    });
  } catch {
    checkpoint = "invalid";
  }
  const terminalStatus = completed[0]?.payload.status;
  const validTerminalStatus = completed.length === 0 || terminalStatus === "converged" ||
    terminalStatus === "no_consensus" || terminalStatus === "failed";
  const structurallyInvalid = started.length !== 1 || completed.length > 1 ||
    (completed.length === 1 && artifacts.length === 0) || !validTerminalStatus;
  const issues: DeliberationInspectionReport["issues"] = [];
  if (structurallyInvalid) {
    issues.push({
      code: "deliberation_history_invalid",
      message: "숙의 시작·산출물·완료 event 관계가 유효하지 않습니다.",
    });
  }
  if (checkpoint === "invalid") {
    issues.push({
      code: "deliberation_checkpoint_invalid",
      message: "숙의 checkpoint 또는 실행 lease를 안전하게 읽지 못했습니다.",
    });
  }
  const terminal = completed[0];
  if (terminal === undefined && checkpoint === "missing") {
    issues.push({
      code: "deliberation_history_incomplete",
      message: "숙의가 끝나지 않았고 승인 checkpoint도 없습니다.",
    });
  }
  const phase = terminal !== undefined
    ? "completed"
    : checkpoint === "readable" && lease === "active"
      ? "running_after_approval"
      : checkpoint === "readable"
        ? "interrupted_after_approval"
        : "rounds";
  const completionStatus = terminal?.type === "deliberation.completed" && validTerminalStatus
    ? terminalStatus as "converged" | "no_consensus" | "failed"
    : null;
  const lastRound = artifacts.reduce<number | null>((maximum, event) => {
    const round = event.type === "deliberation.artifact.recorded" ? event.payload.round : null;
    return typeof round === "number" ? Math.max(maximum ?? 0, round) : maximum;
  }, null);
  return {
    schemaVersion: 1,
    projectId: input.storage.manifest.projectId,
    deliberationId: input.deliberationId,
    sourceStatus: issues.some((issue) => issue.code !== "deliberation_history_incomplete")
      ? "inconsistent"
      : issues.length > 0 ? "incomplete" : "consistent",
    phase,
    completionStatus,
    artifactCount: artifacts.length,
    lastRound,
    checkpoint,
    lease,
    resume: terminal !== undefined
      ? "completed"
      : checkpoint !== "readable"
        ? "not_available"
        : lease === "active" ? "blocked_running" : "candidate",
    issues,
    events: traceEvents,
  };
}

export function formatDeliberationInspection(report: DeliberationInspectionReport): string {
  const phase = ({
    rounds: "검토 회차 진행 중 또는 중단",
    running_after_approval: "승인 뒤 검증·결정 진행 중",
    interrupted_after_approval: "승인 뒤 재개 가능 후보",
    completed: "종료",
  } as const)[report.phase];
  const lines = [
    `숙의 진단: ${report.deliberationId}`,
    `상태: ${phase}`,
    `기록한 산출물: ${report.artifactCount}개${report.lastRound === null ? "" : ` · 마지막 ${report.lastRound}회차`}`,
    `원본 점검: ${report.sourceStatus === "consistent" ? "일관됨" : report.sourceStatus === "incomplete" ? "완료 여부 확인 필요" : "불일치"}`,
    `재개 판정: ${report.resume === "candidate" ? "실제 재개 시 전체 원본 재검증 필요" : report.resume === "blocked_running" ? "현재 process가 실행 중이라 차단" : report.resume === "completed" ? "이미 종료되어 재개 불가" : "승인 checkpoint가 없어 재개 불가"}`,
  ];
  if (report.issues.length > 0) {
    lines.push("확인할 항목:", ...report.issues.map((issue) => `  ${issue.code}: ${issue.message}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeliberationTrace(report: DeliberationInspectionReport): string {
  const summary = formatDeliberationInspection(report).trimEnd();
  const events = report.events.map((event) =>
    `  ${event.seq}. ${event.type} · ${event.occurredAt} · run ${event.runId}`);
  return `${summary}\n기록 (${events.length}개):\n${events.join("\n")}\n`;
}
