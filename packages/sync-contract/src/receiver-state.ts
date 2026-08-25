import { canonicalJson } from "@lervo/event-contract";
import {
  type EventEnvelope,
  type EventSyncAcknowledgement,
  type EventSyncCursor,
  type OutboundEventBatch,
} from "@lervo/schemas";

import {
  assertEventSyncAcknowledgement,
  assertOutboundEventBatch,
  assertSyncableEvent,
} from "./event-batch.js";
import { SyncContractError } from "./errors.js";
import {
  assertProjectRegistrationRequest,
  planProjectRegistrationAcceptance,
  type ProjectRegistrationRecord,
} from "./registration.js";

export interface ProjectSyncState {
  registration: ProjectRegistrationRecord;
  cursor: EventSyncCursor;
  events: EventEnvelope[];
}

function initialCursor(): EventSyncCursor {
  return { seq: 0, eventHash: null };
}

function validTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function assertProjectSyncState(state: ProjectSyncState): void {
  assertProjectRegistrationRequest(state.registration.request);
  if (
    !validTimestamp(state.registration.registeredAt) ||
    !validTimestamp(state.registration.updatedAt)
  ) {
    throw new SyncContractError("invalid_sync_state", "The project registration time is invalid.");
  }
  if (
    !Number.isSafeInteger(state.cursor.seq) ||
    state.cursor.seq < 0 ||
    (state.cursor.seq === 0
      ? state.cursor.eventHash !== null
      : typeof state.cursor.eventHash !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(state.cursor.eventHash))
  ) {
    throw new SyncContractError(
      "invalid_sync_state",
      "The event synchronization cursor is invalid.",
    );
  }
  const seenIds = new Set<string>();
  const bySeq = new Map<number, EventEnvelope>();
  let previous: EventEnvelope | undefined;
  for (const event of state.events) {
    assertSyncableEvent(event);
    if (event.projectId !== state.registration.request.project.projectId) {
      throw new SyncContractError(
        "invalid_sync_state",
        "An event stored by the Hub differs from the project contract.",
      );
    }
    if (seenIds.has(event.eventId) || (previous !== undefined && event.seq <= previous.seq)) {
      throw new SyncContractError(
        "invalid_sync_state",
        "Hub event coordinates are duplicated or unsorted.",
      );
    }
    if (
      previous !== undefined &&
      event.seq === previous.seq + 1 &&
      event.previousHash !== previous.eventHash
    ) {
      throw new SyncContractError("invalid_sync_state", "Hub event hash chains conflict.");
    }
    seenIds.add(event.eventId);
    bySeq.set(event.seq, event);
    previous = event;
  }
  let cursorHash: string | null = null;
  for (let seq = 1; seq <= state.cursor.seq; seq += 1) {
    const event = bySeq.get(seq);
    if (event === undefined || event.previousHash !== cursorHash) {
      throw new SyncContractError(
        "invalid_sync_state",
        "The continuous source event before the Hub cursor is missing.",
      );
    }
    cursorHash = event.eventHash;
  }
  if (state.cursor.eventHash !== cursorHash) {
    throw new SyncContractError(
      "invalid_sync_state",
      "The Hub cursor hash differs from the continuous source event.",
    );
  }
}

export function planProjectRegistration(input: {
  current: ProjectSyncState | null;
  request: ProjectRegistrationRecord["request"];
  acceptedAt: string;
}): {
  state: ProjectSyncState;
  response: ReturnType<typeof planProjectRegistrationAcceptance>["response"];
} {
  if (input.current !== null) assertProjectSyncState(input.current);
  const cursor = input.current?.cursor ?? initialCursor();
  const accepted = planProjectRegistrationAcceptance({
    current: input.current?.registration ?? null,
    cursor,
    request: input.request,
    acceptedAt: input.acceptedAt,
  });
  const state: ProjectSyncState = {
    registration: accepted.record,
    cursor: structuredClone(cursor),
    events: structuredClone(input.current?.events ?? []),
  };
  assertProjectSyncState(state);
  return { state, response: accepted.response };
}

function sameEvent(left: EventEnvelope, right: EventEnvelope): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function planOutboundEventAcceptance(input: {
  state: ProjectSyncState;
  batch: OutboundEventBatch;
  acknowledgedAt: string;
}): { state: ProjectSyncState; acknowledgement: EventSyncAcknowledgement } {
  assertProjectSyncState(input.state);
  assertOutboundEventBatch(input.batch);
  const registration = input.state.registration.request;
  if (
    input.batch.registrationId !== registration.registrationId ||
    input.batch.projectId !== registration.project.projectId ||
    input.batch.destinationId !== registration.destinationId
  ) {
    throw new SyncContractError(
      "registration_required",
      "No project registration matches the outbound event batch.",
    );
  }
  const events = structuredClone(input.state.events);
  const bySeq = new Map(events.map((event) => [event.seq, event]));
  const byId = new Map(events.map((event) => [event.eventId, event]));
  let insertedCount = 0;
  let duplicateCount = 0;
  for (const event of input.batch.events) {
    const atSeq = bySeq.get(event.seq);
    const atId = byId.get(event.eventId);
    if (atSeq !== undefined || atId !== undefined) {
      if (
        atSeq === undefined ||
        atId === undefined ||
        !sameEvent(atSeq, event) ||
        !sameEvent(atId, event)
      ) {
        throw new SyncContractError(
          "event_chain_conflict",
          "A different source already exists for the same project's event sequence or event ID.",
        );
      }
      duplicateCount += 1;
      continue;
    }
    const cloned = structuredClone(event);
    events.push(cloned);
    bySeq.set(cloned.seq, cloned);
    byId.set(cloned.eventId, cloned);
    insertedCount += 1;
  }
  events.sort((left, right) => left.seq - right.seq);
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const event = events[index]!;
    if (event.seq === previous.seq + 1 && event.previousHash !== previous.eventHash) {
      throw new SyncContractError(
        "event_chain_conflict",
        "The out-of-order batch does not connect to the existing event hash chain.",
      );
    }
  }
  let cursor = structuredClone(input.state.cursor);
  while (true) {
    const next = bySeq.get(cursor.seq + 1);
    if (next === undefined) break;
    if (next.previousHash !== cursor.eventHash) {
      throw new SyncContractError(
        "event_chain_conflict",
        "The event after the Hub cursor does not connect to the current hash chain.",
      );
    }
    cursor = { seq: next.seq, eventHash: next.eventHash };
  }
  const state: ProjectSyncState = {
    registration: structuredClone(input.state.registration),
    cursor,
    events,
  };
  assertProjectSyncState(state);
  const acknowledgement: EventSyncAcknowledgement = {
    schemaVersion: 1,
    batchId: input.batch.batchId,
    registrationId: input.batch.registrationId,
    projectId: input.batch.projectId,
    destinationId: input.batch.destinationId,
    status: insertedCount === 0 ? "duplicate" : "accepted",
    acceptedEventIds: input.batch.events.map((event) => event.eventId),
    insertedCount,
    duplicateCount,
    cursor: structuredClone(cursor),
    bufferedEventCount: events.filter((event) => event.seq > cursor.seq).length,
    acknowledgedAt: input.acknowledgedAt,
  };
  assertEventSyncAcknowledgement({ batch: input.batch, acknowledgement });
  return { state, acknowledgement };
}
