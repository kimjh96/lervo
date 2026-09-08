import type { ConversationInboundEvent, ConversationParticipationPolicy } from "@lervo/schemas";

import { InteractionError } from "./errors.js";
import type { ConversationInteractionStore } from "./types.js";

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new InteractionError("invalid_interaction_request", "The interaction clock is invalid.");
  }
  return value.toISOString();
}

export async function withInboundLeaseRenewal<T>(input: {
  store: ConversationInteractionStore;
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  leaseId: string;
  leaseDurationMs: number;
  clock: () => Date;
  operation(): Promise<T>;
}): Promise<T> {
  if (input.store.renewInbound === undefined) return input.operation();
  let active = true;
  let renewal = Promise.resolve();
  const renew = () => {
    if (!active) return;
    renewal = renewal
      .catch(() => undefined)
      .then(() => {
        if (!active) return;
        return input.store.renewInbound!({
          eventId: input.event.eventId,
          policyId: input.policy.policyId,
          roleId: input.policy.roleId,
          leaseId: input.leaseId,
          renewedAt: timestamp(input.clock),
          leaseDurationMs: input.leaseDurationMs,
        });
      });
  };
  const interval = setInterval(renew, Math.max(500, Math.floor(input.leaseDurationMs / 3)));
  interval.unref();
  try {
    return await input.operation();
  } finally {
    active = false;
    clearInterval(interval);
    await renewal.catch(() => undefined);
  }
}
