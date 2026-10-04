import {
  canonicalJson as canonicalEventJson,
  computeEventHash,
  eventWithoutHash,
  sanitizeEventPayload,
} from "@lervo/event-contract";
import { validateSchema, type EventEnvelope, type EventType } from "@lervo/schemas";

import type { RepositorySupplementalSource } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

export const EXECUTION_EVENT_SOURCE_ADAPTER = "execution-event-v1+event-chain";

const MAX_EVENT_BYTES = 256 * 1024;

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

export function executionEvidenceFailure(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_evidence_source_invalid",
    "The execution event evidence source cannot be verified safely and completely.",
  );
}

function fail(): never {
  return executionEvidenceFailure();
}

function canonicalExecutionEvent(event: EventEnvelope): string {
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

export function executionEventSource(event: EventEnvelope): RepositorySupplementalSource | null {
  if (!executionEventTypes.has(event.type)) return null;
  const content = canonicalExecutionEvent(event);
  if (Buffer.byteLength(content) > MAX_EVENT_BYTES) return fail();
  return {
    path: `@event/${event.eventId}`,
    kind: "execution_event",
    classification: "ordinary",
    content,
    origin: "execution_event_store",
    unitKind: "event",
    locator: `event:${event.eventId}`,
    title: `${event.type} event`,
    adapter: EXECUTION_EVENT_SOURCE_ADAPTER,
  };
}
