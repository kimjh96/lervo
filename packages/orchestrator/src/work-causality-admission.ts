import {
  rootWorkId,
  validateWorkCausalityAdmission,
  workCausalityEventId,
} from "@lervo/execution-contract";
import type { WorkCausalityRecordedEventPayload } from "@lervo/schemas";
import { collectEventsOfTypesBounded } from "@lervo/storage-contract";

import type { ManagedWorkCausalityInput } from "./provider-run-types.js";
import type { ManagedEventSpec } from "./telemetry.js";
import type { ManagedEventStore, ManagedRunCoordinates } from "./types.js";

/** Admission depends only on causal records and whether the run was already requested. */
const admissionSourceEventTypes = ["work.causality.recorded", "run.requested"] as const;
/** Bounds the matching events retained, never the length of project history. */
const maximumSourceEvents = 100_000;

export function resolveManagedWorkCausality(input: {
  coordinates: ManagedRunCoordinates;
  request?: ManagedWorkCausalityInput;
}): WorkCausalityRecordedEventPayload {
  const request = input.request ?? { relationship: "root" as const };
  const common = {
    executionContractVersion: 1 as const,
    workstreamId: request.workstreamId ?? null,
    assignmentId: request.assignmentId ?? null,
    agentId: request.agentId ?? null,
  };
  if (request.relationship === "root") {
    return {
      ...common,
      workId: rootWorkId(input.coordinates.projectId, input.coordinates.runId),
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
    };
  }
  return {
    ...common,
    workId: request.workId,
    relationship: request.relationship,
    parentRunId: request.parentRunId,
    retryOfRunId: request.relationship === "retry" ? request.retryOfRunId : null,
    attemptOrdinal:
      request.relationship === "retry" ? request.attemptOrdinal : (request.attemptOrdinal ?? 1),
  } as WorkCausalityRecordedEventPayload;
}

export function admitManagedWorkCausality(input: {
  events: ManagedEventStore;
  coordinates: ManagedRunCoordinates;
  request?: ManagedWorkCausalityInput;
  occurredAt: string;
}): {
  payload: WorkCausalityRecordedEventPayload;
  spec: ManagedEventSpec & { type: "work.causality.recorded"; schemaVersion: 2 };
} {
  const payload = resolveManagedWorkCausality(input);
  const eventId = workCausalityEventId(input.coordinates.projectId, input.coordinates.runId);
  const events = collectEventsOfTypesBounded({
    events: input.events,
    types: admissionSourceEventTypes,
    maximumEvents: maximumSourceEvents,
  });
  const disposition = validateWorkCausalityAdmission({
    events,
    runId: input.coordinates.runId,
    eventId,
    payload,
  });
  const occurredAt =
    disposition === "idempotent"
      ? events.find((event) => event.eventId === eventId)!.occurredAt
      : input.occurredAt;
  return {
    payload,
    spec: {
      eventId,
      type: "work.causality.recorded",
      schemaVersion: 2,
      occurredAt,
      actor: { kind: "system" },
      payload,
    },
  };
}
