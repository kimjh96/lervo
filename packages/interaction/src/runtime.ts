import type { ConversationInboundEvent, ConversationParticipationPolicy } from "@lervo/schemas";

import { InteractionError } from "./errors.js";
import { withInboundLeaseRenewal } from "./inbound-lease-renewal.js";
import {
  assertConversationParticipationScope,
  decideConversationParticipation,
  requiresConversationRelevance,
} from "./participation.js";
import {
  runConversationResponseAttempt,
  type ConversationTerminalFailureState,
} from "./response-attempt.js";
import type {
  ConversationInteractionStore,
  ConversationPublicationVerifier,
  ConversationResponseActivity,
  ConversationResponseFailureClassifier,
  ConversationRelevanceEvaluator,
  ConversationResponder,
  ConversationTerminalFailureResponder,
  ConversationTurnOwnershipEvaluator,
  HandleConversationEventResult,
} from "./types.js";

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new InteractionError("invalid_interaction_request", "The interaction clock is invalid.");
  }
  return value.toISOString();
}

export async function handleConversationEvent(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  workerId: string;
  agentParticipantId: string;
  agentBinding?: ConversationInboundEvent["actor"]["agentBinding"];
  store: ConversationInteractionStore;
  responder: ConversationResponder;
  publicationVerifier: ConversationPublicationVerifier;
  relevanceEvaluator?: ConversationRelevanceEvaluator;
  clock?: () => Date;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  responseActivity?: ConversationResponseActivity;
  responseFailureClassifier?: ConversationResponseFailureClassifier;
  terminalFailureResponder?: ConversationTerminalFailureResponder;
  terminalFailurePublicationVerifier?: ConversationPublicationVerifier;
  maximumResponseAttempts?: number;
  turnOwnershipEvaluator?: ConversationTurnOwnershipEvaluator;
}): Promise<HandleConversationEventResult> {
  const clock = input.clock ?? (() => new Date());
  const claimedAt = timestamp(clock);
  const leaseDurationMs = input.leaseDurationMs ?? 30_000;
  const retryDelayMs = input.retryDelayMs ?? 5_000;
  const maximumResponseAttempts = input.maximumResponseAttempts ?? 3;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.workerId) ||
    !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(input.agentParticipantId) ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1_000 ||
    leaseDurationMs > 300_000 ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 1_000 ||
    retryDelayMs > 3_600_000 ||
    !Number.isSafeInteger(maximumResponseAttempts) ||
    maximumResponseAttempts < 1 ||
    maximumResponseAttempts > 10 ||
    (input.terminalFailureResponder === undefined) !==
      (input.terminalFailurePublicationVerifier === undefined)
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
  const ownsTurn =
    input.turnOwnershipEvaluator === undefined ||
    input.turnOwnershipEvaluator.owns({ event: input.event, policy: input.policy });
  return withInboundLeaseRenewal({
    store: input.store,
    event: input.event,
    policy: input.policy,
    leaseId: claim.leaseId,
    leaseDurationMs,
    clock,
    operation: async () => {
      let earlyActivity: { stop(): void } | null = null;
      if (ownsTurn && input.event.actor.kind === "human" && input.responseActivity !== undefined) {
        try {
          const started = input.responseActivity.start();
          let stopped = false;
          earlyActivity = {
            stop() {
              if (stopped) return;
              stopped = true;
              started.stop();
            },
          };
        } catch {
          earlyActivity = null;
        }
      }
      try {
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
            agentParticipantId: input.agentParticipantId,
            window,
            at: claimedAt,
            ownsTurn,
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
          agentParticipantId: input.agentParticipantId,
          relevance,
          window,
          decidedAt: claimedAt,
          ownsTurn,
        });
        let outbound = null;
        let terminalFailure: ConversationTerminalFailureState | undefined;
        if (decision.action === "respond") {
          const response = await runConversationResponseAttempt({
            event: input.event,
            policy: input.policy,
            decision,
            claim,
            store: input.store,
            responder: input.responder,
            publicationVerifier: input.publicationVerifier,
            agentParticipantId: input.agentParticipantId,
            claimedAt,
            retryDelayMs,
            maximumResponseAttempts,
            clock,
            ...(input.agentBinding === undefined ? {} : { agentBinding: input.agentBinding }),
            ...(input.responseActivity === undefined
              ? {}
              : {
                  responseActivity:
                    earlyActivity === null
                      ? input.responseActivity
                      : { start: () => earlyActivity! },
                }),
            ...(input.responseFailureClassifier === undefined
              ? {}
              : { responseFailureClassifier: input.responseFailureClassifier }),
            ...(input.terminalFailureResponder === undefined
              ? {}
              : { terminalFailureResponder: input.terminalFailureResponder }),
            ...(input.terminalFailurePublicationVerifier === undefined
              ? {}
              : { terminalFailurePublicationVerifier: input.terminalFailurePublicationVerifier }),
          });
          if (response.status === "retry_scheduled") return response;
          outbound = response.outbound;
          terminalFailure = response.terminalFailure;
        }
        try {
          await input.store.completeInbound({
            eventId: input.event.eventId,
            policyId: input.policy.policyId,
            roleId: input.policy.roleId,
            leaseId: claim.leaseId,
            decision,
            outbound,
            ...(terminalFailure === undefined ? {} : { terminalFailure }),
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
        return terminalFailure === undefined
          ? { status: "completed", decision, outbound }
          : {
              status: "failed_terminal",
              decision,
              outbound: outbound!,
              failureCode: terminalFailure.failureCode,
              attemptCount: terminalFailure.attemptCount,
            };
      } finally {
        try {
          earlyActivity?.stop();
        } catch {
          // Transient activity is best-effort and cannot change the response outcome.
        }
      }
    },
  });
}
