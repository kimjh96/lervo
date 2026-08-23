import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";

import {
  readDeliberationEventSnapshot,
} from "./deliberation-event-snapshot.js";
import {
  DeliberationCheckpointError,
  readApprovedDeliberationCheckpoint,
  type ApprovedDeliberationCheckpoint,
} from "./deliberation-checkpoint.js";
import { inspectDeliberationLease } from "./deliberation-lease.js";

export { maximumDeliberationTraceEvents } from "./deliberation-event-snapshot.js";

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

export async function inspectManagedDeliberation(input: {
  storage: ProjectStorage;
  deliberationId: string;
}): Promise<DeliberationInspectionReport> {
  if (!/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.deliberationId)) {
    throw new TypeError("The deliberation ID to inspect is invalid.");
  }
  const integrity = input.storage.events.verifyIntegrity();
  if (!integrity.valid) {
    throw Object.assign(new Error("The deliberation event hash chain is invalid."), {
      code: "deliberation_history_invalid",
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
  const { started, artifacts, completed, traceEvents } = readDeliberationEventSnapshot({
    events: input.storage.events,
    eventCount: integrity.eventCount,
    deliberationId: input.deliberationId,
    checkpointEventIds: new Set(checkpointEventIds),
    checkpointRunIds: new Set(
      checkpointValue?.runtime.artifacts.map((artifact) => artifact.producer.runId) ?? [],
    ),
  });
  if (started.length === 0 && artifacts.length === 0 && completed.length === 0) {
    throw Object.assign(new Error("No events exist for the requested deliberation ID."), {
      code: "deliberation_not_found",
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
      message: "The relationships among deliberation start, artifact, and completion events are invalid.",
    });
  }
  if (checkpoint === "invalid") {
    issues.push({
      code: "deliberation_checkpoint_invalid",
      message: "The deliberation checkpoint or run lease could not be read safely.",
    });
  }
  const terminal = completed[0];
  if (terminal === undefined && checkpoint === "missing") {
    issues.push({
      code: "deliberation_history_incomplete",
      message: "Deliberation has not completed and has no approved checkpoint.",
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
    rounds: "review rounds active or interrupted",
    running_after_approval: "verification and decision active after approval",
    interrupted_after_approval: "eligible to resume after approval",
    completed: "completed",
  } as const)[report.phase];
  const lines = [
    `Deliberation inspection: ${report.deliberationId}`,
    `Status: ${phase}`,
    `Recorded artifacts: ${report.artifactCount}${report.lastRound === null ? "" : ` · last round ${report.lastRound}`}`,
    `Source check: ${report.sourceStatus === "consistent" ? "consistent" : report.sourceStatus === "incomplete" ? "completion needs confirmation" : "inconsistent"}`,
    `Resume assessment: ${report.resume === "candidate" ? "revalidate every source when resuming" : report.resume === "blocked_running" ? "blocked because a process is active" : report.resume === "completed" ? "unavailable because deliberation completed" : "unavailable because no approved checkpoint exists"}`,
  ];
  if (report.issues.length > 0) {
    lines.push("Items to inspect:", ...report.issues.map((issue) => `  ${issue.code}: ${issue.message}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeliberationTrace(report: DeliberationInspectionReport): string {
  const summary = formatDeliberationInspection(report).trimEnd();
  const events = report.events.map((event) =>
    `  ${event.seq}. ${event.type} · ${event.occurredAt} · run ${event.runId}`);
  return `${summary}\nEvents (${events.length}):\n${events.join("\n")}\n`;
}
