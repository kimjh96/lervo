import type { EventEnvelope } from "@lervo/schemas";
import {
  selectWorkstreamCausalRuns,
  type WorkstreamCausalScope,
} from "./workstream-causal-scope.js";
import type {
  ManagedAttemptObservationV1,
  ManagedStageGroupObservationV1,
  ResourceGroupObservationV1,
} from "@lervo/application-contract";

import { managedStageEventTypes, projectManagedStageGroups } from "./managed-stage-projection.js";
import {
  managedResourceEventTypes,
  projectManagedResourceGroups,
} from "./managed-resource-projection.js";

/**
 * Event types `projectManagedAttempts` consumes without a scope anchor. A typed read of them is
 * sufficient input; a caller passing `scopeAnchor` must also read `workstream.snapshot.recorded`.
 */
export const managedAttemptEventTypes: readonly string[] = [
  ...new Set([
    "work.causality.recorded",
    "run.completed",
    "run.failed",
    ...managedResourceEventTypes,
    ...managedStageEventTypes,
  ]),
];

export interface AttemptProjectionV1 {
  attempts: ManagedAttemptObservationV1[];
  resources: ResourceGroupObservationV1[];
  stages: ManagedStageGroupObservationV1[];
}

function terminalState(events: readonly EventEnvelope[]): {
  terminalStatus: ManagedAttemptObservationV1["terminalStatus"];
  verificationStatus: ManagedAttemptObservationV1["verificationStatus"];
} {
  const terminal = events.filter(
    (event) => event.type === "run.completed" || event.type === "run.failed",
  );
  if (terminal.length > 1)
    throw new TypeError("A managed attempt has contradictory terminal events.");
  const event = terminal[0];
  if (event === undefined)
    return { terminalStatus: "in_progress", verificationStatus: "unavailable" };
  if (event.type === "run.failed")
    return { terminalStatus: "failed", verificationStatus: "unavailable" };
  const value = (event.payload as { verificationStatus?: unknown }).verificationStatus;
  return {
    terminalStatus: "completed",
    verificationStatus:
      value === "passed" || value === "failed" || value === "not_run" ? value : "unavailable",
  };
}

export function projectManagedAttempts(input: WorkstreamCausalScope): AttemptProjectionV1 {
  const causality = new Map(
    selectWorkstreamCausalRuns(input).map((record) => [record.runId, record]),
  );
  const attemptRecords = [...causality.values()].filter(
    (record) =>
      record.payload.workstreamId === input.workstreamId &&
      record.payload.assignmentId !== null &&
      (record.payload.relationship === "root" || record.payload.relationship === "retry"),
  );
  const assignmentByWork = new Map<string, string>();
  for (const record of attemptRecords) {
    const assignmentId = record.payload.assignmentId!;
    const existing = assignmentByWork.get(record.payload.workId);
    if (existing !== undefined && existing !== assignmentId) {
      throw new TypeError("A governed work tree crosses assignment authority.");
    }
    assignmentByWork.set(record.payload.workId, assignmentId);
  }
  const attemptKeys = new Set<string>();
  const attempts = attemptRecords
    .map<ManagedAttemptObservationV1>((record) => {
      const key = `${record.payload.assignmentId}\0${record.payload.attemptOrdinal}`;
      if (attemptKeys.has(key))
        throw new TypeError("An assignment has duplicate attempt ordinals.");
      attemptKeys.add(key);
      return {
        schemaVersion: 1,
        assignmentId: record.payload.assignmentId!,
        workId: record.payload.workId,
        runId: record.runId,
        relationship: record.payload.relationship as "root" | "retry",
        attemptOrdinal: record.payload.attemptOrdinal,
        ...terminalState(input.events.filter((event) => event.runId === record.runId)),
      };
    })
    .sort(
      (left, right) =>
        left.assignmentId.localeCompare(right.assignmentId) ||
        left.attemptOrdinal - right.attemptOrdinal,
    );

  const workIds = new Set(attempts.map((attempt) => attempt.workId));
  const workRuns = [...causality.values()].filter((record) => workIds.has(record.payload.workId));
  const resources = projectManagedResourceGroups({ events: input.events, workRuns });
  const stages = projectManagedStageGroups({ events: input.events, workRuns });
  return { attempts, resources, stages };
}
