import { createHash } from "node:crypto";

import { validateSchema } from "@lervo/schemas";

import {
  ManagedConversationResponseError,
  type ManagedConversationResponsePlan,
  type ManagedConversationResponseRequest,
  type ManagedConversationResponderOptions,
} from "./types.js";

export function validateConversationResponseRequest(
  options: ManagedConversationResponderOptions,
  input: ManagedConversationResponseRequest,
  plan: ManagedConversationResponsePlan,
): void {
  const presentation = plan.role.outputContract.presentation;
  if (
    input.decision.action !== "respond" ||
    input.event.eventId !== input.decision.eventId ||
    input.event.target.projectId !== options.projectId ||
    input.policy.projectId !== options.projectId ||
    input.decision.projectId !== options.projectId ||
    input.policy.policyId !== input.decision.policyId ||
    input.policy.roleId !== input.decision.roleId ||
    (plan.participationRoleId ?? plan.role.roleId) !== input.policy.roleId ||
    plan.role.capabilities["filesystem.write"] !== "deny" ||
    plan.role.capabilities["external.message"] !== "deny" ||
    presentation.audience === "machine" ||
    presentation.writingPolicyId !== plan.writingContract.writingPolicyId ||
    plan.writingPolicy.writingPolicyId !== plan.writingContract.writingPolicyId ||
    !plan.writingContract.surfaces.includes("chat") ||
    (plan.maximumResponseCharacters !== undefined &&
      (!Number.isSafeInteger(plan.maximumResponseCharacters) ||
        plan.maximumResponseCharacters < 1 ||
        plan.maximumResponseCharacters > 65_536)) ||
    (plan.executionIdentity.agentId !== null &&
      !/^agt_[a-f0-9]{24}$/u.test(plan.executionIdentity.agentId)) ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(plan.executionIdentity.provider) ||
    plan.executionIdentity.provider !== plan.adapter.descriptor.provider ||
    (plan.executionIdentity.model !== null &&
      (plan.executionIdentity.model.length < 1 || plan.executionIdentity.model.length > 128)) ||
    !validateSchema("role", plan.role).valid ||
    !validateSchema("writingContract", plan.writingContract).valid
  ) {
    throw new ManagedConversationResponseError(
      "invalid_response_request",
      "The conversation response project, role, read-only execution, or writing policy is inconsistent.",
    );
  }
}

export function conversationResponseRequestDigest(input: {
  request: ManagedConversationResponseRequest;
  plan: ManagedConversationResponsePlan;
  policyVersion: string;
}): string {
  const value = JSON.stringify({
    eventId: input.request.event.eventId,
    policyId: input.request.policy.policyId,
    policyVersion: input.policyVersion,
    decision: {
      action: input.request.decision.action,
      reason: input.request.decision.reason,
      relevance: input.request.decision.relevance,
    },
    roleId: input.plan.role.roleId,
    executionIdentity: input.plan.executionIdentity,
    participationRoleId: input.plan.participationRoleId ?? input.plan.role.roleId,
    maximumResponseCharacters: input.plan.maximumResponseCharacters ?? 65_536,
    messageHash: input.request.event.content.contentHash,
    priorTurns: input.request.context?.priorTurns ?? [],
  });
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function conversationResponseInstructions(
  input: ManagedConversationResponseRequest,
  message: string,
  executionIdentity: ManagedConversationResponsePlan["executionIdentity"],
  executionRoleId = input.policy.roleId,
  maximumResponseCharacters = 65_536,
): string {
  return JSON.stringify({
    task: "conversation_response",
    participationRoleId: input.policy.roleId,
    executionRoleId,
    executionIdentity,
    conversationId: input.event.target.conversationId,
    threadId: input.event.target.threadId,
    participationReason: input.decision.reason,
    requirements: [
      "Respond using the injected shared context and the conversation source below.",
      "Respond in the primary language of the message unless the message requests another language.",
      "Do not claim to have seen documents that were neither loaded nor injected.",
      "When asked about your agent, provider, or model identity, answer only from executionIdentity and distinguish the durable agent from this turn's provider and model.",
      "Write only the response body; do not send directly to an external platform.",
      `Keep the response at or below ${maximumResponseCharacters} Unicode characters.`,
    ],
    priorTurns: input.context?.priorTurns ?? [],
    message,
  });
}
