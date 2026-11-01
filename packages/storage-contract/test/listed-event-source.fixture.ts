import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions } from "@lervo/storage-contract";

/** Lists in-memory events with the store's afterSeq, limit, runId, and types semantics. */
export function listedEvents(source: readonly EventEnvelope[]) {
  return ({ afterSeq = 0, limit = 100, runId, types }: ListEventsOptions = {}): EventEnvelope[] =>
    source
      .filter(
        (event) =>
          event.seq > afterSeq &&
          (runId === undefined || event.runId === runId) &&
          (types === undefined || types.includes(event.type)),
      )
      .slice(0, limit);
}

/** The head sequence of a history longer than every former 100,000-event reader bound. */
export const longHistoryHeadSeq = 100_500;

/**
 * Places the given events after 100,000 unrelated events and adds one unrelated head event.
 * The returned list rejects any unfiltered read below the head, so a reader passes only when it
 * reads by type or run instead of walking the whole history.
 */
export function longHistoryEvents(source: readonly EventEnvelope[]): {
  events: EventEnvelope[];
  head: EventEnvelope;
  list(options?: ListEventsOptions): EventEnvelope[];
} {
  const placed = source.map((event, index) => ({ ...event, seq: 100_001 + index }));
  const head: EventEnvelope = {
    ...source.at(-1)!,
    eventId: "evt_long_history_head",
    runId: "run_long_history_unrelated",
    sessionId: "ses_long_history_unrelated",
    seq: longHistoryHeadSeq,
    type: "context.selected",
    schemaVersion: 1,
    payload: {},
    eventHash: `sha256:${"f".repeat(64)}`,
  } as EventEnvelope;
  const events = [...placed, head];
  const list = listedEvents(events);
  return {
    events,
    head,
    list: (options: ListEventsOptions = {}) => {
      if (
        options.types === undefined &&
        options.runId === undefined &&
        (options.afterSeq ?? 0) < longHistoryHeadSeq - 1
      ) {
        throw new Error("The reader walked the whole project history.");
      }
      return list(options);
    },
  };
}
