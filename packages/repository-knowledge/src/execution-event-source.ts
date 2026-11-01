import type { EventStore } from "@lervo/storage-contract";

import { collectRecentExecutionEventSources } from "./recent-execution-event-source.js";
import type { RepositorySupplementalSource } from "./types.js";

export { EXECUTION_EVENT_SOURCE_ADAPTER } from "./execution-event-evidence.js";
export const EXECUTION_EVENT_SOURCE_MAX_EVENTS = 32_768;

/**
 * The legacy single-corpus adapter: the most recent execution events of the verified snapshot
 * within 32,768 sources and 16 MiB, in path order. A longer history selects this window instead of
 * failing (ADR-0554); every older execution event is still validated.
 */
export function collectExecutionEventSources(input: {
  events: Pick<EventStore, "latest" | "list">;
}): RepositorySupplementalSource[] {
  return collectRecentExecutionEventSources({
    events: input.events,
    maximumEvents: EXECUTION_EVENT_SOURCE_MAX_EVENTS,
  }).sort((left, right) => left.path.localeCompare(right.path));
}
