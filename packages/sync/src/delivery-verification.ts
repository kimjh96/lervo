import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

/** A local history problem found right before a batch would leave this host (ADR-0602). */
export class LocalHistoryIntegrityError extends Error {
  readonly code = "local_history_invalid";
  constructor(message: string) {
    super(message);
    this.name = "LocalHistoryIntegrityError";
  }
}

/**
 * ADR-0602: re-proves one contiguous batch right before it is sent. Each event must still be the
 * exact stored row (the store re-checks its hash on read), and the first event must link to the
 * stored event before it, so a batch never carries history that changed after it was claimed.
 */
export function verifyDeliveryRange(
  store: Pick<EventStore, "get" | "list">,
  events: readonly EventEnvelope[],
): void {
  for (const event of events)
    if (store.get(event.eventId)?.eventHash !== event.eventHash)
      throw new LocalHistoryIntegrityError("A claimed event changed before it was sent.");
  const first = events[0];
  if (first === undefined) return;
  const previous = first.seq <= 1 ? null : store.list({ afterSeq: first.seq - 2, limit: 1 })[0];
  const previousHash = first.seq <= 1 ? null : (previous?.eventHash ?? undefined);
  if (previous !== null && previous?.seq !== first.seq - 1)
    throw new LocalHistoryIntegrityError("The event before a claimed batch is missing.");
  if (previousHash !== first.previousHash)
    throw new LocalHistoryIntegrityError("A claimed batch does not link to the stored history.");
}
