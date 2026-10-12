import type { EventEnvelope } from "@lervo/schemas";
import { visitEventSnapshot, type EventStore } from "@lervo/storage-contract";

import { executionEventSource, executionEvidenceFailure } from "./execution-event-evidence.js";
import type { RepositorySupplementalSource } from "./types.js";

export { EXECUTION_EVENT_SOURCE_ADAPTER } from "./execution-event-evidence.js";
const MAX_EVENT_SEQUENCE = 100_000;
export const EXECUTION_EVENT_SOURCE_MAX_EVENTS = 32_768;
const MAX_TOTAL_EVENT_BYTES = 16 * 1024 * 1024;

export function collectExecutionEventSources(input: {
  events: Pick<EventStore, "latest" | "list">;
}): RepositorySupplementalSource[] {
  let latest: EventEnvelope | null;
  try {
    latest = input.events.latest();
  } catch {
    return executionEvidenceFailure();
  }
  if (latest === null) return [];
  if (!Number.isSafeInteger(latest.seq) || latest.seq < 1 || latest.seq > MAX_EVENT_SEQUENCE)
    return executionEvidenceFailure();

  const sources: RepositorySupplementalSource[] = [];
  const eventIds = new Set<string>();
  let totalBytes = 0;
  try {
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      throughHash: latest.eventHash,
      visit: (event) => {
        const source = executionEventSource(event);
        if (source === null) return;
        if (eventIds.has(event.eventId) || sources.length >= EXECUTION_EVENT_SOURCE_MAX_EVENTS)
          return executionEvidenceFailure();
        const byteCount = Buffer.byteLength(source.content);
        totalBytes += byteCount;
        if (totalBytes > MAX_TOTAL_EVENT_BYTES) return executionEvidenceFailure();
        eventIds.add(event.eventId);
        sources.push(source);
      },
    });
  } catch {
    return executionEvidenceFailure();
  }
  return sources.sort((left, right) => left.path.localeCompare(right.path));
}
