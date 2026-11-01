import type { EventStore } from "@lervo/storage-contract";
import { visitEventSnapshot } from "@lervo/storage-contract";

import { executionEvidenceFailure } from "./execution-event-evidence.js";
import { ExecutionEventWindow } from "./execution-event-window.js";
import type { RepositorySupplementalSource } from "./types.js";

const maximumWindowEvents = 32_768;
const maximumWindowBytes = 16 * 1024 * 1024;

function recentWindowEvents(maximumEvents: number): number {
  if (
    !Number.isSafeInteger(maximumEvents) ||
    maximumEvents < 1 ||
    maximumEvents > maximumWindowEvents
  )
    throw new TypeError("The execution event window limit is invalid.");
  return maximumEvents;
}

/** Receives every event in a verified snapshot, including events outside the retained window. */
export class RecentExecutionEventProjection extends ExecutionEventWindow {
  constructor(maximumEvents: number) {
    super(recentWindowEvents(maximumEvents), maximumWindowBytes);
  }
}

/**
 * Returns the most recent execution events of the verified snapshot through the observed head,
 * within `maximumEvents` and 16 MiB. History length never makes it fail (ADR-0554); it never
 * establishes complete-history coverage.
 */
export function collectRecentExecutionEventSources(input: {
  events: Pick<EventStore, "latest" | "list">;
  maximumEvents: number;
}): RepositorySupplementalSource[] {
  const projection = new RecentExecutionEventProjection(input.maximumEvents);
  try {
    const latest = input.events.latest();
    if (latest === null) return [];
    if (!Number.isSafeInteger(latest.seq) || latest.seq < 1) return executionEvidenceFailure();
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      throughHash: latest.eventHash,
      visit: (event) => projection.observe(event),
    });
    return projection.sources();
  } catch {
    return executionEvidenceFailure();
  }
}
