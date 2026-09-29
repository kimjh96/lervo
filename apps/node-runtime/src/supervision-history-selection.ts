import type { EventEnvelope } from "@lervo/schemas";
import { selectWorkstreamCausalRuns } from "@lervo/work-controller";

/** Control metadata stays complete; unrelated native bodies do not establish this owner's facts. */
export function isSupervisionHistoryMetadata(event: EventEnvelope): boolean {
  return (
    event.type.startsWith("work.") ||
    event.type.startsWith("workstream.") ||
    event.type.startsWith("organization.") ||
    event.type.startsWith("assignment.") ||
    event.type === "run.requested"
  );
}

/** Retain complete causal trees and explicitly linked runs, including bytes before their binding. */
export function selectSupervisionHistoryRuns(
  metadata: readonly EventEnvelope[],
  workstreamId: string,
): Set<string> {
  const runs = new Set(
    selectWorkstreamCausalRuns({ events: metadata, workstreamId }).map((record) => record.runId),
  );
  const assignments = new Set(
    metadata
      .filter(
        (event) =>
          event.type === "assignment.created" && event.payload.workstreamId === workstreamId,
      )
      .map((event) => event.payload.assignmentId),
  );
  for (const event of metadata)
    if (
      event.payload.workstreamId === workstreamId &&
      typeof event.payload.managedRunId === "string"
    )
      runs.add(event.payload.managedRunId);
    else if (
      event.type === "run.requested" &&
      (event.payload.workstreamId === workstreamId || assignments.has(event.payload.assignmentId))
    )
      runs.add(event.runId);
  return runs;
}
