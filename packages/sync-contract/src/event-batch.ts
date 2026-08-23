import {
  canonicalJson,
  computeEventHash,
  eventWithoutHash,
  sanitizeEventPayload,
} from "@lervo/event-contract";
import {
  validateSchema,
  type EventEnvelope,
  type EventSyncAcknowledgement,
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
} from "@lervo/schemas";

import { SyncContractError } from "./errors.js";
import { syncContentId } from "./hash.js";
import { assertProjectRegistrationRequest } from "./registration.js";

type BatchContent = Omit<OutboundEventBatch, "batchId">;

export function assertSyncableEvent(event: EventEnvelope): void {
  if (!validateSchema("event", event).valid || computeEventHash(eventWithoutHash(event)) !== event.eventHash) {
    throw new SyncContractError("invalid_event_batch", "A synchronization event schema or hash is invalid.");
  }
  let sanitized;
  try {
    sanitized = sanitizeEventPayload(event.type, event.payload);
  } catch (error) {
    throw new SyncContractError(
      "invalid_event_batch",
      "The synchronization event payload does not satisfy the allowlist contract.",
      { cause: error },
    );
  }
  if (
    sanitized.redactions.length !== 0 ||
    canonicalJson(sanitized.payload) !== canonicalJson(event.payload)
  ) {
    throw new SyncContractError(
      "invalid_event_batch",
      "A synchronization event cannot contain payload fields outside the allowlist.",
    );
  }
}

function assertEventSequence(events: readonly EventEnvelope[], projectId: string): void {
  for (const [index, event] of events.entries()) {
    assertSyncableEvent(event);
    if (event.projectId !== projectId) {
      throw new SyncContractError("invalid_event_batch", "A batch can contain events from only one project.");
    }
    const previous = events[index - 1];
    if (previous !== undefined && (
      event.seq !== previous.seq + 1 || event.previousHash !== previous.eventHash
    )) {
      throw new SyncContractError(
        "invalid_event_batch",
        "Events within a batch must have continuous sequence numbers and hash chains.",
      );
    }
  }
}

export function calculateOutboundEventBatchId(content: BatchContent): string {
  return syncContentId("hsb", content);
}

export function assertOutboundEventBatch(batch: OutboundEventBatch): void {
  if (!validateSchema("outboundEventBatch", batch).valid) {
    throw new SyncContractError("invalid_event_batch", "The outbound event batch schema is invalid.");
  }
  assertEventSequence(batch.events, batch.projectId);
  const first = batch.events[0]!;
  const last = batch.events.at(-1)!;
  const { batchId: _batchId, ...content } = batch;
  if (
    batch.firstSeq !== first.seq ||
    batch.lastSeq !== last.seq ||
    batch.previousHash !== first.previousHash ||
    batch.headHash !== last.eventHash ||
    batch.batchId !== calculateOutboundEventBatchId(content)
  ) {
    throw new SyncContractError(
      "invalid_event_batch",
      "The outbound event batch range, hash, or ID differs from the source events.",
    );
  }
}

export function createOutboundEventBatch(input: {
  registration: ProjectRegistrationRequest;
  events: readonly EventEnvelope[];
}): OutboundEventBatch {
  assertProjectRegistrationRequest(input.registration);
  if (input.events.length === 0) {
    throw new SyncContractError("invalid_event_batch", "An empty outbound event batch cannot be created.");
  }
  const events = structuredClone([...input.events]);
  assertEventSequence(events, input.registration.project.projectId);
  const first = events[0]!;
  const last = events.at(-1)!;
  const content: BatchContent = {
    schemaVersion: 1,
    registrationId: input.registration.registrationId,
    projectId: input.registration.project.projectId,
    destinationId: input.registration.destinationId,
    firstSeq: first.seq,
    lastSeq: last.seq,
    previousHash: first.previousHash,
    headHash: last.eventHash,
    events,
  };
  const batch: OutboundEventBatch = {
    ...content,
    batchId: calculateOutboundEventBatchId(content),
  };
  assertOutboundEventBatch(batch);
  return structuredClone(batch);
}

export function assertEventSyncAcknowledgement(input: {
  batch: OutboundEventBatch;
  acknowledgement: EventSyncAcknowledgement;
}): void {
  assertOutboundEventBatch(input.batch);
  const acknowledgement = input.acknowledgement;
  if (!validateSchema("eventSyncAcknowledgement", acknowledgement).valid) {
    throw new SyncContractError("invalid_acknowledgement", "The event synchronization acknowledgement schema is invalid.");
  }
  const eventIds = input.batch.events.map((event) => event.eventId);
  if (
    acknowledgement.batchId !== input.batch.batchId ||
    acknowledgement.registrationId !== input.batch.registrationId ||
    acknowledgement.projectId !== input.batch.projectId ||
    acknowledgement.destinationId !== input.batch.destinationId ||
    canonicalJson(acknowledgement.acceptedEventIds) !== canonicalJson(eventIds) ||
    acknowledgement.insertedCount + acknowledgement.duplicateCount !== eventIds.length ||
    (acknowledgement.status === "duplicate") !== (acknowledgement.insertedCount === 0)
  ) {
    throw new SyncContractError(
      "invalid_acknowledgement",
      "The event synchronization acknowledgement does not prove durable acceptance of the requested batch.",
    );
  }
}
