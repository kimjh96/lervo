import { createHash } from "node:crypto";

import { type EventEnvelope, type EventEnvelopeV1 } from "@lervo/schemas";

import { canonicalJson } from "./canonical-json.js";

export type EventDraft = Omit<EventEnvelopeV1, "seq" | "previousHash" | "eventHash" | "payload"> & {
  payload: Readonly<Record<string, unknown>>;
};

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
