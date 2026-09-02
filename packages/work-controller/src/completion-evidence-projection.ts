import type { AssignmentCompletionEvidenceV1 } from "@lervo/application-contract";
import {
  validateSchema,
  type AssignmentCompletionPreparedEventPayload,
  type EventEnvelope,
  type RunCompletedEventPayload,
} from "@lervo/schemas";

import { sha256 } from "./hash.js";

export type CompletionEvidenceCoordinate = Omit<
  AssignmentCompletionEvidenceV1,
  "schemaVersion" | "completionEvidenceId"
>;

export function completionEvidenceId(coordinate: CompletionEvidenceCoordinate): string {
  return `acp_${sha256(JSON.stringify(coordinate)).slice("sha256:".length, "sha256:".length + 24)}`;
}

export function projectCompletionEvidence(input: {
  events: readonly EventEnvelope[];
  attempts: readonly {
    assignmentId: string;
    runId: string;
    terminalStatus: "in_progress" | "completed" | "failed";
    verificationStatus: "passed" | "failed" | "not_run" | "unavailable";
  }[];
  workstreamId: string;
}): AssignmentCompletionEvidenceV1[] {
  const attemptsByRun = new Map(input.attempts.map((attempt) => [attempt.runId, attempt] as const));
  const completedByRun = new Map(
    input.events
      .filter((event) => event.type === "run.completed")
      .map((event) => [event.runId, event] as const),
  );
  const byEvidenceId = new Map<string, AssignmentCompletionEvidenceV1>();
  const evidenceByRun = new Map<string, string>();

  for (const event of input.events.filter(
    (candidate) => candidate.type === "assignment.completion.prepared",
  )) {
    const validation = validateSchema("assignmentCompletionPreparedEventPayload", event.payload);
    if (!validation.valid || event.actor.kind !== "system") {
      throw new TypeError("A governed completion preparation event is invalid.");
    }
    const payload = event.payload as AssignmentCompletionPreparedEventPayload;
    const attempt = attemptsByRun.get(event.runId);
    const completed = completedByRun.get(event.runId);
    if (
      attempt === undefined ||
      completed === undefined ||
      completed.sessionId !== event.sessionId ||
      attempt.assignmentId !== payload.assignmentId ||
      attempt.terminalStatus !== "completed" ||
      attempt.verificationStatus !== "passed" ||
      payload.workstreamId !== input.workstreamId ||
      payload.preparedAt !== event.occurredAt ||
      Date.parse(payload.preparedAt) < Date.parse(completed.occurredAt)
    ) {
      throw new TypeError("A governed completion preparation differs from its managed run.");
    }
    const runPayload = completed.payload as RunCompletedEventPayload;
    if (
      runPayload.resultDigest !== payload.resultContentHash ||
      !runPayload.artifactIds.includes(payload.resultArtifactId)
    ) {
      throw new TypeError("A governed completion preparation differs from the run result.");
    }
    const coordinate: CompletionEvidenceCoordinate = {
      workstreamId: payload.workstreamId,
      assignmentId: payload.assignmentId,
      assignmentRevision: payload.assignmentRevision,
      agentId: payload.agentId,
      leaseId: payload.leaseId,
      runId: event.runId,
      sessionId: event.sessionId,
      resultArtifactId: payload.resultArtifactId,
      resultContentHash: payload.resultContentHash,
      preparedAt: payload.preparedAt,
    };
    if (completionEvidenceId(coordinate) !== payload.completionEvidenceId) {
      throw new TypeError("A governed completion preparation ID is invalid.");
    }
    const observation: AssignmentCompletionEvidenceV1 = {
      schemaVersion: 1,
      completionEvidenceId: payload.completionEvidenceId,
      ...coordinate,
    };
    const existing = byEvidenceId.get(observation.completionEvidenceId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(observation)) {
      throw new TypeError("A governed completion preparation is contradictory.");
    }
    const existingRunEvidence = evidenceByRun.get(observation.runId);
    if (
      existingRunEvidence !== undefined &&
      existingRunEvidence !== observation.completionEvidenceId
    ) {
      throw new TypeError("A governed run has multiple completion preparations.");
    }
    byEvidenceId.set(observation.completionEvidenceId, observation);
    evidenceByRun.set(observation.runId, observation.completionEvidenceId);
  }

  return [...byEvidenceId.values()].sort((left, right) =>
    left.completionEvidenceId.localeCompare(right.completionEvidenceId),
  );
}
