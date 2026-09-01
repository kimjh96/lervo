import {
  rootWorkId,
  validateWorkCausalityAdmission,
  WorkCausalityError,
  workCausalityEventId,
} from "@lervo/execution-contract";
import type { WorkCausalityRecordedEventPayload } from "@lervo/schemas";
import { collectProjectEventsBounded, type EventStore } from "@lervo/storage-contract";

import type { DeliberationEventSpec } from "./event-recorder.js";
import type { DeliberationRuntimeCoordinates } from "./types.js";

const maximumSourceEvents = 100_000;

export function deliberationRootCausality(input: {
  events: EventStore;
  coordinates: DeliberationRuntimeCoordinates;
  occurredAt: string;
}): { payload: WorkCausalityRecordedEventPayload; spec: DeliberationEventSpec } {
  const payload: WorkCausalityRecordedEventPayload = {
    workId: rootWorkId(input.coordinates.projectId, input.coordinates.runId),
    executionContractVersion: 1,
    relationship: "root",
    parentRunId: null,
    retryOfRunId: null,
    attemptOrdinal: 1,
    workstreamId: null,
    assignmentId: null,
    agentId: null,
  };
  const eventId = workCausalityEventId(input.coordinates.projectId, input.coordinates.runId);
  const events = collectProjectEventsBounded({
    events: input.events,
    maximumEvents: maximumSourceEvents,
  });
  const disposition = validateWorkCausalityAdmission({
    events,
    runId: input.coordinates.runId,
    eventId,
    payload,
  });
  if (
    events.some(
      (event) => event.runId === input.coordinates.runId && event.type === "deliberation.started",
    )
  ) {
    throw new WorkCausalityError(
      "causality_run_already_started",
      `Deliberation ${input.coordinates.runId} has already been admitted.`,
    );
  }
  return {
    payload,
    spec: {
      eventId,
      schemaVersion: 2,
      type: "work.causality.recorded",
      coordinates: input.coordinates,
      occurredAt:
        disposition === "idempotent"
          ? events.find((event) => event.eventId === eventId)!.occurredAt
          : input.occurredAt,
      actor: { kind: "system" },
      payload,
    },
  };
}
