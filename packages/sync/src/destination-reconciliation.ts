import type { EventSyncCursor } from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";

import { SyncWorkerError } from "./errors.js";

export interface DestinationReconciliationResult {
  scannedCount: number;
  enqueuedCount: number;
}

/**
 * Reconciles the authoritative local event chain with one explicitly configured
 * Hub destination. The Hub cursor is the lower bound: events after it must have
 * durable delivery work before the worker claims a batch.
 */
export function reconcileDestinationOutbox(input: {
  store: OutboxStore;
  destinationId: string;
  cursor: EventSyncCursor;
  enqueuedAt: string;
  limit: number;
}): DestinationReconciliationResult {
  try {
    if (input.cursor.seq > 0) {
      const cursorEvent = input.store.list({
        afterSeq: input.cursor.seq - 1,
        limit: 1,
      })[0];
      if (
        cursorEvent === undefined ||
        cursorEvent.seq !== input.cursor.seq ||
        cursorEvent.eventHash !== input.cursor.eventHash
      ) {
        throw new SyncWorkerError(
          "outbox_update_failed",
          "The authenticated Hub cursor differs from the local event chain.",
        );
      }
    }

    const events = input.store.list({ afterSeq: input.cursor.seq, limit: input.limit });
    const enqueuedCount = input.store.transact((transaction) =>
      events.reduce(
        (count, event) =>
          count +
          Number(
            transaction.enqueue({
              eventId: event.eventId,
              destinationId: input.destinationId,
              enqueuedAt: input.enqueuedAt,
            }).inserted,
          ),
        0,
      ),
    );
    return { scannedCount: events.length, enqueuedCount };
  } catch (error) {
    if (error instanceof SyncWorkerError) throw error;
    throw new SyncWorkerError(
      "outbox_update_failed",
      "Could not reconcile local events with the configured Hub destination.",
      { cause: error },
    );
  }
}
