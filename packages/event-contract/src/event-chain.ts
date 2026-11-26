import { createHash } from "node:crypto";

import {
  type EventEnvelope,
  type EventEnvelopeV1,
  type EventEnvelopeV2,
  type EventEnvelopeV3,
  type EventEnvelopeV4,
  type EventEnvelopeV5,
  type EventEnvelopeV6,
  type EventEnvelopeV7,
  type EventEnvelopeV8,
  type EventEnvelopeV9,
  type EventEnvelopeV10,
  type EventEnvelopeV11,
  type EventEnvelopeV12,
  type EventEnvelopeV13,
  type EventEnvelopeV14,
  type EventEnvelopeV15,
} from "@lervo/schemas";

import { canonicalJson } from "./canonical-json.js";

type EventDraftFor<T> = Omit<T, "seq" | "previousHash" | "eventHash" | "payload"> & {
  payload: Readonly<Record<string, unknown>>;
};

export type EventDraftV1 = EventDraftFor<EventEnvelopeV1>;
export type EventDraftV2 = EventDraftFor<EventEnvelopeV2>;
export type EventDraftV3 = EventDraftFor<EventEnvelopeV3>;
export type EventDraftV4 = EventDraftFor<EventEnvelopeV4>;
export type EventDraftV5 = EventDraftFor<EventEnvelopeV5>;
export type EventDraftV6 = EventDraftFor<EventEnvelopeV6>;
export type EventDraftV7 = EventDraftFor<EventEnvelopeV7>;
export type EventDraftV8 = EventDraftFor<EventEnvelopeV8>;
export type EventDraftV9 = EventDraftFor<EventEnvelopeV9>;
export type EventDraftV10 = EventDraftFor<EventEnvelopeV10>;
export type EventDraftV11 = EventDraftFor<EventEnvelopeV11>;
export type EventDraftV12 = EventDraftFor<EventEnvelopeV12>;
export type EventDraftV13 = EventDraftFor<EventEnvelopeV13>;
export type EventDraftV14 = EventDraftFor<EventEnvelopeV14>;
export type EventDraftV15 = EventDraftFor<EventEnvelopeV15>;
export type EventDraft =
  | EventDraftV1
  | EventDraftV2
  | EventDraftV3
  | EventDraftV4
  | EventDraftV5
  | EventDraftV6
  | EventDraftV7
  | EventDraftV8
  | EventDraftV9
  | EventDraftV10
  | EventDraftV11
  | EventDraftV12
  | EventDraftV13
  | EventDraftV14
  | EventDraftV15;

export type EventHashInput = Omit<EventEnvelope, "eventHash">;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function eventWithoutHash(event: EventEnvelope): EventHashInput {
  const { eventHash: _eventHash, ...withoutHash } = event;
  return withoutHash;
}

export function computeEventHash(event: EventHashInput): string {
  return sha256(canonicalJson(event));
}

export function eventIdentity(
  event: EventDraft | EventEnvelope,
  payload: Readonly<Record<string, unknown>>,
): string {
  return canonicalJson({
    eventId: event.eventId,
    projectId: event.projectId,
    runId: event.runId,
    sessionId: event.sessionId,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: event.actor,
    schemaVersion: event.schemaVersion,
    policyVersion: event.policyVersion,
    payload,
  });
}
