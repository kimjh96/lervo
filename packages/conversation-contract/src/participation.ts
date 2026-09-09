import { canonicalJson } from "@lervo/event-contract";
import {
  type ConversationInboundEvent,
  type ConversationParticipationDecision,
  type ConversationParticipationPolicy,
  type ConversationParticipationReason,
  validateSchema,
} from "@lervo/schemas";

import { ConversationContractError } from "./errors.js";
import { clone, digest, sortedUnique } from "./shared.js";

type PolicyContent = Omit<ConversationParticipationPolicy, "policyId">;
type DecisionContent = Omit<ConversationParticipationDecision, "decisionId">;

const responseReasons = new Set<ConversationParticipationReason>([
  "owned_human_message",
  "mentioned",
  "relevant",
  "proactive_signal",
]);

export function calculateConversationParticipationPolicyId(content: PolicyContent): string {
  return `cpp_${digest(canonicalJson(clone(content))).slice("sha256:".length)}`;
}

export function createConversationParticipationPolicy(
  input: Omit<PolicyContent, "schemaVersion">,
): ConversationParticipationPolicy {
  const content: PolicyContent = {
    schemaVersion: 1,
    ...clone(input),
    conversationIds: [...input.conversationIds].sort(),
    respondTo: [...input.respondTo].sort(),
    signalCodes: [...input.signalCodes].sort(),
  };
  const policy = {
    ...content,
    policyId: calculateConversationParticipationPolicyId(content),
  };
  assertConversationParticipationPolicy(policy);
  return clone(policy);
}

export function assertConversationParticipationPolicy(
  policy: ConversationParticipationPolicy,
): void {
  if (!validateSchema("conversationParticipationPolicy", policy).valid) {
    throw new ConversationContractError(
      "invalid_participation_policy",
      "The conversation participation policy contract is invalid.",
    );
  }
  const { policyId: _policyId, ...content } = policy;
  if (
    policy.policyId !== calculateConversationParticipationPolicyId(content) ||
    !sortedUnique(policy.conversationIds) ||
    !sortedUnique(policy.respondTo) ||
    !sortedUnique(policy.signalCodes)
  ) {
    throw new ConversationContractError(
      "invalid_participation_policy",
      "The conversation participation policy ID or set order differs from the source.",
    );
  }
}

export function calculateConversationParticipationDecisionId(content: DecisionContent): string {
  return `cpd_${digest(canonicalJson(clone(content))).slice("sha256:".length)}`;
}

export function createConversationParticipationDecision(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  action: ConversationParticipationDecision["action"];
  reason: ConversationParticipationReason;
  relevance: ConversationParticipationDecision["relevance"];
  decidedAt: string;
}): ConversationParticipationDecision {
  const content: DecisionContent = {
    schemaVersion: 1,
    eventId: input.event.eventId,
    policyId: input.policy.policyId,
    projectId: input.event.target.projectId,
    conversationId: input.event.target.conversationId,
    roleId: input.policy.roleId,
    action: input.action,
    reason: input.reason,
    relevance: input.relevance,
    decidedAt: input.decidedAt,
  };
  const decision = {
    ...content,
    decisionId: calculateConversationParticipationDecisionId(content),
  };
  assertConversationParticipationDecision({
    decision,
    event: input.event,
    policy: input.policy,
  });
  return clone(decision);
}

export function assertConversationParticipationDecision(input: {
  decision: ConversationParticipationDecision;
  event?: ConversationInboundEvent;
  policy?: ConversationParticipationPolicy;
}): void {
  const { decision } = input;
  if (!validateSchema("conversationParticipationDecision", decision).valid) {
    throw new ConversationContractError(
      "invalid_participation_decision",
      "The conversation participation decision contract is invalid.",
    );
  }
  const { decisionId: _decisionId, ...content } = decision;
  const responseReason = responseReasons.has(decision.reason);
  const relevanceMatches =
    (decision.reason === "relevant" && decision.relevance === "relevant") ||
    (decision.reason === "not_relevant" && decision.relevance === "not_relevant") ||
    (decision.reason === "relevance_unavailable" && decision.relevance === "unknown") ||
    (!["relevant", "not_relevant", "relevance_unavailable"].includes(decision.reason) &&
      decision.relevance === "not_checked");
  if (
    decision.decisionId !== calculateConversationParticipationDecisionId(content) ||
    (decision.action === "respond") !== responseReason ||
    !relevanceMatches ||
    (input.event !== undefined &&
      (decision.eventId !== input.event.eventId ||
        decision.projectId !== input.event.target.projectId ||
        decision.conversationId !== input.event.target.conversationId)) ||
    (input.policy !== undefined &&
      (decision.policyId !== input.policy.policyId ||
        decision.projectId !== input.policy.projectId ||
        decision.roleId !== input.policy.roleId))
  ) {
    throw new ConversationContractError(
      "invalid_participation_decision",
      "The conversation decision ID, action, reason, or source coordinates differ.",
    );
  }
}
