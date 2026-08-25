import { type OutboxDelivery } from "@lervo/storage-contract";

import { SyncWorkerError } from "./errors.js";
import { type OutboundSyncWorkerOptions, type SyncRetryFailureCode } from "./types.js";

export function assertClaimedDeliveries(input: {
  deliveries: readonly OutboxDelivery[];
  destinationId: string;
  workerId: string;
  limit: number;
}): void {
  if (
    input.deliveries.length > input.limit ||
    input.deliveries.some(
      (delivery) =>
        delivery.destinationId !== input.destinationId ||
        delivery.status !== "leased" ||
        delivery.lease?.workerId !== input.workerId,
    )
  ) {
    throw new SyncWorkerError(
      "outbox_update_failed",
      "The outbox claim result does not match the requested destination and lease ownership.",
    );
  }
}

export function acknowledgeDeliveries(input: {
  options: OutboundSyncWorkerOptions;
  deliveries: readonly OutboxDelivery[];
  acknowledgedAt: string;
}): void {
  try {
    input.options.store.transact((transaction) => {
      for (const delivery of input.deliveries) {
        const result = transaction.acknowledge({
          eventId: delivery.event.eventId,
          destinationId: delivery.destinationId,
          workerId: input.options.workerId,
          acknowledgedAt: input.acknowledgedAt,
        });
        if (!result.acknowledged) {
          throw new Error("outbox acknowledgement did not transition");
        }
      }
    });
  } catch (error) {
    throw new SyncWorkerError(
      "outbox_update_failed",
      "The local outbox could not be updated atomically after the Hub acknowledgement.",
      { cause: error },
    );
  }
}

export function rescheduleDeliveries(input: {
  options: OutboundSyncWorkerOptions;
  deliveries: readonly OutboxDelivery[];
  failedAt: string;
  availableAt: string;
  failureCode: SyncRetryFailureCode;
}): void {
  try {
    input.options.store.transact((transaction) => {
      for (const delivery of input.deliveries) {
        transaction.reschedule({
          eventId: delivery.event.eventId,
          destinationId: delivery.destinationId,
          workerId: input.options.workerId,
          failedAt: input.failedAt,
          availableAt: input.availableAt,
          failureCode: input.failureCode,
        });
      }
    });
  } catch (error) {
    throw new SyncWorkerError(
      "outbox_update_failed",
      "A local outbox retry could not be scheduled atomically after the delivery failed.",
      { cause: error },
    );
  }
}
