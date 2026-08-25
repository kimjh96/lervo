import { createConversationOutboundMessage } from "@lervo/conversation-contract";
import type { ConversationInboundEvent, ConversationParticipationPolicy } from "@lervo/schemas";

import { InteractionError } from "./errors.js";
import {
  assertConversationParticipationScope,
  decideConversationParticipation,
  requiresConversationRelevance,
} from "./participation.js";
import type {
  ConversationInteractionStore,
  ConversationPublicationVerifier,
  ConversationRelevanceEvaluator,
  ConversationResponder,
  HandleConversationEventResult,
} from "./types.js";

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new InteractionError("invalid_interaction_request", "The interaction clock is invalid.");
  }
  return value.toISOString();
}

function later(value: string, delayMs: number): string {
  return new Date(Date.parse(value) + delayMs).toISOString();
}

export async function handleConversationEvent(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  workerId: string;
  agentParticipantId: string;
  store: ConversationInteractionStore;
  responder: ConversationResponder;
  publicationVerifier: ConversationPublicationVerifier;
  relevanceEvaluator?: ConversationRelevanceEvaluator;
  clock?: () => Date;
  leaseDurationMs?: number;
  retryDelayMs?: number;
}): Promise<HandleConversationEventResult> {
  const clock = input.clock ?? (() => new Date());
  const claimedAt = timestamp(clock);
  const leaseDurationMs = input.leaseDurationMs ?? 30_000;
  const retryDelayMs = input.retryDelayMs ?? 5_000;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.workerId) ||
    !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(input.agentParticipantId) ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1_000 ||
    leaseDurationMs > 300_000 ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 1_000 ||
    retryDelayMs > 3_600_000
  )
    throw new InteractionError(
      "invalid_interaction_request",
      "The interaction runtime configuration is invalid.",
    );
  assertConversationParticipationScope({
    event: input.event,
    policy: input.policy,
    at: claimedAt,
  });

  let claim;
  try {
    claim = await input.store.claimInbound({
      event: input.event,
      policy: input.policy,
      workerId: input.workerId,
      claimedAt,
      leaseDurationMs,
    });
  } catch (error) {
    throw new InteractionError("interaction_store_failed", "The conversation inbox claim failed.", {
      cause: error,
    });
  }
  if (claim.status === "busy") return { status: "busy" };
  if (claim.status === "completed") {
    return { status: "duplicate", decision: claim.decision, outbound: claim.outbound };
  }

  let window;
  try {
    window = await input.store.getParticipationWindow({
      policyId: input.policy.policyId,
      conversationId: input.event.target.conversationId,
      at: claimedAt,
    });
  } catch (error) {
    throw new InteractionError(
      "interaction_store_failed",
      "The participation window query failed.",
      {
        cause: error,
      },
    );
  }
  let relevance: "not_checked" | "relevant" | "not_relevant" | "unknown" = "not_checked";
  if (
    requiresConversationRelevance({
      event: input.event,
      policy: input.policy,
      window,
      at: claimedAt,
    })
  ) {
    if (input.relevanceEvaluator === undefined) {
      relevance = "unknown";
    } else {
      try {
        relevance = await input.relevanceEvaluator.evaluate({
          event: input.event,
          policy: input.policy,
        });
      } catch {
        relevance = "unknown";
      }
    }
  }
  const decision = decideConversationParticipation({
    event: input.event,
    policy: input.policy,
    relevance,
    window,
    decidedAt: claimedAt,
  });
  let outbound = null;
  if (decision.action === "respond") {
    let candidate;
    try {
      candidate = await input.responder.respond({
        event: input.event,
        policy: input.policy,
        decision,
      });
    } catch {
      const nextAttemptAt = later(claimedAt, retryDelayMs);
      await input.store.rescheduleInbound({
        eventId: input.event.eventId,
        policyId: input.policy.policyId,
        roleId: input.policy.roleId,
        leaseId: claim.leaseId,
        failedAt: claimedAt,
        availableAt: nextAttemptAt,
        failureCode: "response_generation_failed",
      });
      return {
        status: "retry_scheduled",
        failureCode: "response_generation_failed",
        nextAttemptAt,
      };
    }
    try {
      await input.publicationVerifier.verify({
        candidate,
        event: input.event,
        policy: input.policy,
      });
      outbound = createConversationOutboundMessage({
        event: input.event,
        policy: input.policy,
        participantId: input.agentParticipantId,
        content: candidate.content,
        publicationPermit: candidate.publicationPermit,
        createdAt: timestamp(clock),
      });
    } catch {
      const nextAttemptAt = later(claimedAt, retryDelayMs);
      await input.store.rescheduleInbound({
        eventId: input.event.eventId,
        policyId: input.policy.policyId,
        roleId: input.policy.roleId,
        leaseId: claim.leaseId,
        failedAt: claimedAt,
        availableAt: nextAttemptAt,
        failureCode: "publication_verification_failed",
      });
      return {
        status: "retry_scheduled",
        failureCode: "publication_verification_failed",
        nextAttemptAt,
      };
    }
  }
  try {
    await input.store.completeInbound({
      eventId: input.event.eventId,
      policyId: input.policy.policyId,
      roleId: input.policy.roleId,
      leaseId: claim.leaseId,
      decision,
      outbound,
    });
  } catch (error) {
    throw new InteractionError(
      "interaction_store_failed",
      "The conversation decision commit failed.",
      {
        cause: error,
      },
    );
  }
  return { status: "completed", decision, outbound };
}
