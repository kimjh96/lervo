import type { EventStore } from "@lervo/storage-contract";
import { visitEventSnapshot } from "@lervo/storage-contract";

import { executionEventSource, executionEvidenceFailure } from "./execution-event-evidence.js";
import type { RepositorySupplementalSource } from "./types.js";

const maximumWindowEvents = 32_768;
const maximumWindowBytes = 16 * 1024 * 1024;

/** A bounded interactive projection; it never establishes complete-history coverage. */
export function collectRecentExecutionEventSources(input: {
  events: Pick<EventStore, "latest" | "list" | "verifyIntegrity">;
  maximumEvents: number;
}): RepositorySupplementalSource[] {
  if (
    !Number.isSafeInteger(input.maximumEvents) ||
    input.maximumEvents < 1 ||
    input.maximumEvents > maximumWindowEvents
  )
    throw new TypeError("The execution event window limit is invalid.");

  const window: RepositorySupplementalSource[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  let first = 0;
  try {
    if (!input.events.verifyIntegrity().valid) return executionEvidenceFailure();
    const latest = input.events.latest();
    if (latest === null) return [];
    if (!Number.isSafeInteger(latest.seq) || latest.seq < 1) return executionEvidenceFailure();
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      visit: (event) => {
        const source = executionEventSource(event);
        if (source === null) return;
        if (ids.has(event.eventId)) return executionEvidenceFailure();
        const sourceBytes = Buffer.byteLength(source.content);
        while (
          window.length - first >= input.maximumEvents ||
          bytes + sourceBytes > maximumWindowBytes
        ) {
          const removed = window[first++]!;
          bytes -= Buffer.byteLength(removed.content);
          ids.delete(removed.path.slice("@event/".length));
        }
        window.push(source);
        ids.add(event.eventId);
        bytes += sourceBytes;
        if (first >= input.maximumEvents) {
          window.splice(0, first);
          first = 0;
        }
      },
    });
    if (!input.events.verifyIntegrity().valid) return executionEvidenceFailure();
    return window.slice(first);
  } catch {
    return executionEvidenceFailure();
  }
}
