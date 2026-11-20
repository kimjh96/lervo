import { latestEventHashExcluding, type EventStore } from "@lervo/storage-contract";

/**
 * ADR-0598: event types a knowledge resident appends only to record its own outcome. Each one
 * is committed together with the state that carries its follow-up, and that state is already in
 * the resident's fence, so the event itself never needs to wake the resident:
 *
 * - `repository.knowledge.stage.recorded`: the successor job is enqueued in the same commit, and
 *   the fence reads the knowledge outbox counts and earliest due time.
 * - `document.freshness.cycle.completed`: a summary; freshness work lives in the freshness state
 *   and hold files the fence reads.
 * - `knowledge.instruction_capture.cycle.completed`: a summary; captured work lives in the
 *   capture queue the fence lists.
 *
 * Types that carry an obligation, an ownership change, or work for another reader (for example
 * convergence records, owner changes, candidate exchange, and materialization) are not listed and
 * still wake the resident. The same events appended by any other process are ignored as well;
 * their follow-up reaches the resident through the same outbox and state.
 */
export const RESIDENT_AUTHORED_EVENT_TYPES: readonly string[] = Object.freeze([
  "repository.knowledge.stage.recorded",
  "document.freshness.cycle.completed",
  "knowledge.instruction_capture.cycle.completed",
]);

/** The head hash of events a resident must react to: everything but its own outcome records. */
export function foreignEventsHead(
  events: Pick<EventStore, "latest" | "latestHash" | "latestHashExcluding">,
): string | null {
  return latestEventHashExcluding(events, RESIDENT_AUTHORED_EVENT_TYPES);
}
