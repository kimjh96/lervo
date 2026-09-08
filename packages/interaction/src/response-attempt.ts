import { createConversationOutboundMessage } from "@lervo/conversation-contract";
import type {
  ConversationInboundEvent,
  ConversationOutboundMessage,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
} from "@lervo/schemas";

import { InteractionError } from "./errors.js";
import type {
  ConversationInboundClaim,
  ConversationInteractionStore,
  ConversationPublicationVerifier,
  ConversationResponseActivity,
  ConversationResponseFailure,
  ConversationResponseFailureClassifier,
  ConversationResponder,
  ConversationTerminalFailureResponder,
  HandleConversationEventResult,
} from "./types.js";

const defaultResponseFailure: ConversationResponseFailure = {
  failureCode: "response_generation_failed",
  retryable: true,
};

export interface ConversationTerminalFailureState {
  failureCode: ConversationResponseFailure["failureCode"];
  attemptCount: number;
  failedAt: string;
}

export type ConversationResponseAttemptResult =
  | Extract<HandleConversationEventResult, { status: "retry_scheduled" }>
  | {
      status: "completed";
      outbound: ConversationOutboundMessage;
      terminalFailure?: ConversationTerminalFailureState;
    };

function createdAt(clock: () => Date): string {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new InteractionError("invalid_interaction_request", "The interaction clock is invalid.");
  }
  return value.toISOString();
}

function later(value: string, delayMs: number): string {
  return new Date(Date.parse(value) + delayMs).toISOString();
}

async function reschedule(input: {
  store: ConversationInteractionStore;
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  leaseId: string;
  claimedAt: string;
  retryDelayMs: number;
  failureCode: ConversationResponseFailure["failureCode"];
}): Promise<Extract<HandleConversationEventResult, { status: "retry_scheduled" }>> {
  const nextAttemptAt = later(input.claimedAt, input.retryDelayMs);
  await input.store.rescheduleInbound({
    eventId: input.event.eventId,
    policyId: input.policy.policyId,
    roleId: input.policy.roleId,
    leaseId: input.leaseId,
    failedAt: input.claimedAt,
    availableAt: nextAttemptAt,
    failureCode: input.failureCode,
  });
  return { status: "retry_scheduled", failureCode: input.failureCode, nextAttemptAt };
}

function outbound(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  agentParticipantId: string;
  agentBinding?: ConversationInboundEvent["actor"]["agentBinding"];
  candidate: Awaited<ReturnType<ConversationResponder["respond"]>>;
  clock: () => Date;
}): ConversationOutboundMessage {
  return createConversationOutboundMessage({
    event: input.event,
    policy: input.policy,
    participantId: input.agentParticipantId,
    ...(input.agentBinding === undefined ? {} : { agentBinding: input.agentBinding }),
    content: input.candidate.content,
    publicationPermit: input.candidate.publicationPermit,
    createdAt: createdAt(input.clock),
  });
}

async function terminal(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  decision: ConversationParticipationDecision;
  claim: Extract<ConversationInboundClaim, { status: "claimed" }>;
  failureCode: ConversationResponseFailure["failureCode"];
  terminalFailureResponder: ConversationTerminalFailureResponder;
  terminalFailurePublicationVerifier: ConversationPublicationVerifier;
  agentParticipantId: string;
  agentBinding?: ConversationInboundEvent["actor"]["agentBinding"];
  claimedAt: string;
  clock: () => Date;
}): Promise<ConversationResponseAttemptResult> {
  const candidate = await input.terminalFailureResponder.respond({
    event: input.event,
    policy: input.policy,
    decision: input.decision,
    failureCode: input.failureCode,
    attemptCount: input.claim.attemptCount,
  });
  await input.terminalFailurePublicationVerifier.verify({
    candidate,
    event: input.event,
    policy: input.policy,
  });
  return {
    status: "completed",
    outbound: outbound({ ...input, candidate }),
    terminalFailure: {
      failureCode: input.failureCode,
      attemptCount: input.claim.attemptCount,
      failedAt: input.claimedAt,
    },
  };
}

export async function runConversationResponseAttempt(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  decision: ConversationParticipationDecision;
  claim: Extract<ConversationInboundClaim, { status: "claimed" }>;
  store: ConversationInteractionStore;
  responder: ConversationResponder;
  publicationVerifier: ConversationPublicationVerifier;
  responseFailureClassifier?: ConversationResponseFailureClassifier;
  terminalFailureResponder?: ConversationTerminalFailureResponder;
  terminalFailurePublicationVerifier?: ConversationPublicationVerifier;
  responseActivity?: ConversationResponseActivity;
  agentParticipantId: string;
  agentBinding?: ConversationInboundEvent["actor"]["agentBinding"];
  claimedAt: string;
  retryDelayMs: number;
  maximumResponseAttempts: number;
  clock: () => Date;
}): Promise<ConversationResponseAttemptResult> {
  let activity: ReturnType<ConversationResponseActivity["start"]> | null = null;
  try {
    try {
      activity = input.responseActivity?.start() ?? null;
    } catch {
      activity = null;
    }
    let candidate: Awaited<ReturnType<ConversationResponder["respond"]>>;
    try {
      candidate = await input.responder.respond({
        event: input.event,
        policy: input.policy,
        decision: input.decision,
      });
    } catch (error) {
      const failure = input.responseFailureClassifier?.classify(error) ?? defaultResponseFailure;
      if (failure.retryable && input.claim.attemptCount < input.maximumResponseAttempts) {
        return reschedule({
          ...input,
          leaseId: input.claim.leaseId,
          failureCode: failure.failureCode,
        });
      }
      if (
        input.terminalFailureResponder === undefined ||
        input.terminalFailurePublicationVerifier === undefined
      ) {
        return reschedule({
          ...input,
          leaseId: input.claim.leaseId,
          failureCode: failure.failureCode,
        });
      }
      return terminal({
        ...input,
        failureCode: failure.failureCode,
        terminalFailureResponder: input.terminalFailureResponder,
        terminalFailurePublicationVerifier: input.terminalFailurePublicationVerifier,
      });
    }
    try {
      await input.publicationVerifier.verify({
        candidate,
        event: input.event,
        policy: input.policy,
      });
      return { status: "completed", outbound: outbound({ ...input, candidate }) };
    } catch {
      if (
        input.claim.attemptCount >= input.maximumResponseAttempts &&
        input.terminalFailureResponder !== undefined &&
        input.terminalFailurePublicationVerifier !== undefined
      ) {
        return terminal({
          ...input,
          failureCode: "publication_verification_failed",
          terminalFailureResponder: input.terminalFailureResponder,
          terminalFailurePublicationVerifier: input.terminalFailurePublicationVerifier,
        });
      }
      return reschedule({
        ...input,
        leaseId: input.claim.leaseId,
        failureCode: "publication_verification_failed",
      });
    }
  } finally {
    try {
      activity?.stop();
    } catch {
      // Transient activity is best-effort and cannot change the response outcome.
    }
  }
}
