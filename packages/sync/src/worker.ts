import { type EventSyncAcknowledgement } from "@lervo/schemas";
import {
  assertEventSyncAcknowledgement,
  createOutboundEventBatch,
  SyncContractError,
} from "@lervo/sync-contract";

import { partitionContiguousDeliveries } from "./batching.js";
import {
  acknowledgeDeliveries,
  assertClaimedDeliveries,
  rescheduleDeliveries,
} from "./outbox-lifecycle.js";
import { authenticatedResponseBody } from "./peer-response.js";
import { registerProject } from "./project-registration.js";
import {
  registrationFailureCode,
  RetryableSyncFailure,
} from "./retry-failure.js";
import {
  calculateNextAttemptAt,
  clockTimestamp,
  resolveWorkerConfiguration,
} from "./runtime-configuration.js";
import {
  type OutboundSyncWorkerOptions,
  type SyncCycleResult,
} from "./types.js";

async function sendBatch(input: {
  options: OutboundSyncWorkerOptions;
  registration: Awaited<ReturnType<typeof registerProject>>;
  deliveries: ReturnType<typeof partitionContiguousDeliveries>[number];
}): Promise<EventSyncAcknowledgement> {
  let batch;
  try {
    batch = createOutboundEventBatch({
      registration: input.registration.request,
      events: input.deliveries.map((delivery) => delivery.event),
    });
  } catch (error) {
    if (error instanceof SyncContractError) {
      throw new RetryableSyncFailure("local_batch_invalid");
    }
    throw error;
  }

  let transportResponse: unknown;
  try {
    transportResponse = await input.options.transport.sendEventBatch(batch);
  } catch {
    throw new RetryableSyncFailure("hub_unavailable");
  }
  const body = authenticatedResponseBody({
    response: transportResponse,
    destinationId: input.options.destinationId,
    expectedPeerIdentityHash: input.options.expectedPeerIdentityHash,
  });
  try {
    const acknowledgement = body as EventSyncAcknowledgement;
    assertEventSyncAcknowledgement({ batch, acknowledgement });
    return structuredClone(acknowledgement);
  } catch {
    throw new RetryableSyncFailure("invalid_sync_ack");
  }
}

export async function runOutboundSyncCycle(
  options: OutboundSyncWorkerOptions,
): Promise<SyncCycleResult> {
  const configuration = resolveWorkerConfiguration(options);
  let registration;
  try {
    registration = await registerProject({
      options,
      requestedAt: clockTimestamp(configuration.clock),
    });
  } catch (error) {
    if (!(error instanceof RetryableSyncFailure)) throw error;
    const failedAt = clockTimestamp(configuration.clock);
    return {
      status: "registration_deferred",
      failureCode: registrationFailureCode(error.code),
      nextAttemptAt: calculateNextAttemptAt(failedAt, configuration.retryDelayMs),
      claimedCount: 0,
      acknowledgedCount: 0,
      rescheduledCount: 0,
      acknowledgedBatchCount: 0,
    };
  }

  const claimed = options.store.claim({
    workerId: options.workerId,
    claimedAt: clockTimestamp(configuration.clock),
    leaseDurationMs: configuration.leaseDurationMs,
    destinationId: options.destinationId,
    limit: configuration.batchLimit,
  });
  assertClaimedDeliveries({
    deliveries: claimed,
    destinationId: options.destinationId,
    workerId: options.workerId,
    limit: configuration.batchLimit,
  });
  if (claimed.length === 0) {
    return {
      status: "idle",
      registrationStatus: registration.response.status,
      cursor: structuredClone(registration.response.cursor),
      claimedCount: 0,
      acknowledgedCount: 0,
      rescheduledCount: 0,
      acknowledgedBatchCount: 0,
    };
  }

  const groups = partitionContiguousDeliveries(claimed);
  let acknowledgedCount = 0;
  let acknowledgedBatchCount = 0;
  let cursor = structuredClone(registration.response.cursor);
  for (const [index, group] of groups.entries()) {
    try {
      const acknowledgement = await sendBatch({ options, registration, deliveries: group });
      cursor = structuredClone(acknowledgement.cursor);
    } catch (error) {
      if (!(error instanceof RetryableSyncFailure)) throw error;
      const remaining = groups.slice(index).flat();
      const failedAt = clockTimestamp(configuration.clock);
      const availableAt = calculateNextAttemptAt(failedAt, configuration.retryDelayMs);
      rescheduleDeliveries({
        options,
        deliveries: remaining,
        failedAt,
        availableAt,
        failureCode: error.code,
      });
      return {
        status: "retry_scheduled",
        registrationStatus: registration.response.status,
        cursor,
        failureCode: error.code,
        nextAttemptAt: availableAt,
        claimedCount: claimed.length,
        acknowledgedCount,
        rescheduledCount: remaining.length,
        acknowledgedBatchCount,
      };
    }

    acknowledgeDeliveries({
      options,
      deliveries: group,
      acknowledgedAt: clockTimestamp(configuration.clock),
    });
    acknowledgedCount += group.length;
    acknowledgedBatchCount += 1;
  }

  return {
    status: "synchronized",
    registrationStatus: registration.response.status,
    cursor,
    claimedCount: claimed.length,
    acknowledgedCount,
    rescheduledCount: 0,
    acknowledgedBatchCount,
  };
}
