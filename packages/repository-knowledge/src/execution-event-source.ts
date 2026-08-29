import {
  canonicalJson as canonicalEventJson,
  computeEventHash,
  eventWithoutHash,
  sanitizeEventPayload,
} from "@lervo/event-contract";
import { validateSchema, type EventEnvelope, type EventType } from "@lervo/schemas";
import { visitEventSnapshot, type EventStore } from "@lervo/storage-contract";

import type { RepositorySupplementalSource } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

export const EXECUTION_EVENT_SOURCE_ADAPTER = "execution-event-v1+event-chain";

const MAX_EVENT_SEQUENCE = 100_000;
export const EXECUTION_EVENT_SOURCE_MAX_EVENTS = 8_192;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_TOTAL_EVENT_BYTES = 16 * 1024 * 1024;

const executionEventTypes = new Set<EventType>([
  "run.requested",
  "run.resolved",
  "run.completed",
  "run.failed",
  "context.recommended",
  "context.selected",
  "document.loaded",
  "context.injected",
  "context.invalidated",
  "context.published",
  "handoff.created",
  "adapter.started",
  "adapter.stopped",
  "capability.requested",
  "capability.decided",
  "capability.activated",
  "capability.recommended",
  "capability.selected",
  "capability.loaded",
  "capability.invoked",
  "capability.completed",
  "tool.called",
  "command.executed",
  "file.changed",
  "skill.resolved",
  "skill.invoked",
  "skill.completed",
  "verification.started",
  "deliberation.started",
  "deliberation.artifact.recorded",
  "deliberation.completed",
  "unmanaged_change.detected",
]);

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_evidence_source_invalid",
    "The execution event evidence source cannot be verified safely and completely.",
  );
}

function canonicalEvent(event: EventEnvelope): string {
  if (!validateSchema("event", event).valid) return fail();
  if (computeEventHash(eventWithoutHash(event)) !== event.eventHash) return fail();
  let sanitized;
  try {
    sanitized = sanitizeEventPayload(event.type, event.payload);
  } catch {
    return fail();
  }
  if (
    sanitized.redactions.length !== 0 ||
    canonicalEventJson(sanitized.payload) !== canonicalEventJson(event.payload)
  )
    return fail();
  try {
    return `${canonicalEventJson(event)}\n`;
  } catch {
    return fail();
  }
}

export function collectExecutionEventSources(input: {
  events: Pick<EventStore, "latest" | "list" | "verifyIntegrity">;
}): RepositorySupplementalSource[] {
  let latest: EventEnvelope | null;
  try {
    if (!input.events.verifyIntegrity().valid) return fail();
    latest = input.events.latest();
  } catch {
    return fail();
  }
  if (latest === null) return [];
  if (!Number.isSafeInteger(latest.seq) || latest.seq < 1 || latest.seq > MAX_EVENT_SEQUENCE)
    return fail();

  const sources: RepositorySupplementalSource[] = [];
  const eventIds = new Set<string>();
  let totalBytes = 0;
  try {
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      visit: (event) => {
        if (!executionEventTypes.has(event.type)) return;
        if (eventIds.has(event.eventId) || sources.length >= EXECUTION_EVENT_SOURCE_MAX_EVENTS)
          return fail();
        const content = canonicalEvent(event);
        const byteCount = Buffer.byteLength(content);
        totalBytes += byteCount;
        if (byteCount > MAX_EVENT_BYTES || totalBytes > MAX_TOTAL_EVENT_BYTES) return fail();
        eventIds.add(event.eventId);
        sources.push({
          path: `@event/${event.eventId}`,
          kind: "execution_event",
          classification: "ordinary",
          content,
          origin: "execution_event_store",
          unitKind: "event",
          locator: `event:${event.eventId}`,
          title: `${event.type} event`,
          adapter: EXECUTION_EVENT_SOURCE_ADAPTER,
        });
      },
    });
    if (!input.events.verifyIntegrity().valid) return fail();
  } catch {
    return fail();
  }
  return sources.sort((left, right) => left.path.localeCompare(right.path));
}
