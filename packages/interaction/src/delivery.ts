import {
  assertConversationAdapterDescriptor,
  assertConversationDeliveryReceipt,
} from "@lervo/conversation-contract";

import { InteractionError } from "./errors.js";
import type {
  ConversationAdapter,
  ConversationDeliveryCycleResult,
  ConversationInteractionStore,
} from "./types.js";

function now(clock: () => Date): string {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new InteractionError("invalid_interaction_request", "The delivery clock is invalid.");
  }
  return value.toISOString();
}

export async function runConversationDeliveryCycle(input: {
  adapter: ConversationAdapter;
  store: ConversationInteractionStore;
  workerId: string;
  clock?: () => Date;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  maximumDeliveryAttempts?: number;
  limit?: number;
  onDelivered?(input: {
    outbound: import("@lervo/schemas").ConversationOutboundMessage;
    receipt: import("@lervo/schemas").ConversationDeliveryReceipt;
  }): void | Promise<void>;
}): Promise<ConversationDeliveryCycleResult> {
  assertConversationAdapterDescriptor(input.adapter.descriptor);
  const leaseDurationMs = input.leaseDurationMs ?? 30_000;
  const retryDelayMs = input.retryDelayMs ?? 5_000;
  const maximumDeliveryAttempts = input.maximumDeliveryAttempts ?? 3;
  const limit = input.limit ?? 8;
  if (
    !input.adapter.descriptor.capabilities.includes("messages.send") ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.workerId) ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1_000 ||
    leaseDurationMs > 300_000 ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 1_000 ||
    retryDelayMs > 3_600_000 ||
    !Number.isSafeInteger(maximumDeliveryAttempts) ||
    maximumDeliveryAttempts < 1 ||
    maximumDeliveryAttempts > 10 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 16
  )
    throw new InteractionError(
      "invalid_interaction_request",
      "The conversation delivery configuration is invalid.",
    );
  const clock = input.clock ?? (() => new Date());
  const claimedAt = now(clock);
  let leases;
  try {
    leases = await input.store.claimOutbound({
      integrationId: input.adapter.descriptor.integrationId,
      workerId: input.workerId,
      claimedAt,
      leaseDurationMs,
      limit,
    });
  } catch (error) {
    throw new InteractionError(
      "interaction_store_failed",
      "The conversation outbox claim failed.",
      {
        cause: error,
      },
    );
  }
  let deliveredCount = 0;
  let retryScheduledCount = 0;
  let attentionRequiredCount = 0;
  for (const lease of leases) {
    let failureCode: "adapter_delivery_failed" | "invalid_delivery_receipt" | null = null;
    let receipt: import("@lervo/schemas").ConversationDeliveryReceipt | null = null;
    try {
      receipt = await input.adapter.deliver(lease.outbound);
    } catch {
      failureCode = "adapter_delivery_failed";
    }
    if (receipt !== null) {
      try {
        assertConversationDeliveryReceipt({
          receipt,
          outbound: lease.outbound,
          descriptor: input.adapter.descriptor,
        });
      } catch {
        failureCode = "invalid_delivery_receipt";
      }
    }
    if (failureCode === null && receipt !== null) {
      await input.store.acknowledgeOutbound({
        outboundId: lease.outbound.outboundId,
        leaseId: lease.leaseId,
        receipt,
      });
      deliveredCount += 1;
      await input.onDelivered?.({ outbound: lease.outbound, receipt });
      continue;
    }
    const failedAt = now(clock);
    if (
      failureCode === "invalid_delivery_receipt" ||
      lease.attemptCount >= maximumDeliveryAttempts
    ) {
      await input.store.markOutboundAttentionRequired({
        outboundId: lease.outbound.outboundId,
        leaseId: lease.leaseId,
        failedAt,
        failureCode: failureCode ?? "adapter_delivery_failed",
      });
      attentionRequiredCount += 1;
    } else {
      await input.store.rescheduleOutbound({
        outboundId: lease.outbound.outboundId,
        leaseId: lease.leaseId,
        failedAt,
        availableAt: new Date(Date.parse(failedAt) + retryDelayMs).toISOString(),
        failureCode: failureCode ?? "adapter_delivery_failed",
      });
      retryScheduledCount += 1;
    }
  }
  return {
    status: leases.length === 0 ? "idle" : "processed",
    deliveredCount,
    retryScheduledCount,
    attentionRequiredCount,
  };
}
