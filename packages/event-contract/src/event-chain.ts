import { createHash } from "node:crypto";

import { type EventEnvelope } from "@roven/schemas";

import { canonicalJson } from "./canonical-json.js";

export type EventDraft = Omit<
  EventEnvelope,
  "seq" | "previousHash" | "eventHash" | "payload"
> & {
  payload: Readonly<Record<string, unknown>>;
};

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function eventWithoutHash(event: EventEnvelope): Omit<EventEnvelope, "eventHash"> {
  const { eventHash: _eventHash, ...withoutHash } = event;
  return withoutHash;
}

export function computeEventHash(event: Omit<EventEnvelope, "eventHash">): string {
  return sha256(canonicalJson(event));
}

export function eventIdentity(
  event: EventDraft | EventEnvelope,
  payload: EventEnvelope["payload"],
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
