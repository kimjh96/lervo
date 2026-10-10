import { createHash } from "node:crypto";

import type { ConversationCompletedEffectResult } from "@lervo/interaction";
import { validateSchema } from "@lervo/schemas";

import {
  ManagedConversationResponseError,
  type ManagedConversationResponsePlan,
  type ManagedConversationResponseRequest,
  type ManagedConversationResponderOptions,
} from "./types.js";

function validCompletedEffect(value: ConversationCompletedEffectResult | undefined): boolean {
  if (value === undefined) return true;
  return (
    /^[a-z][a-z0-9_.-]{0,95}$/u.test(value.effectId) &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(value.resultCode) &&
    value.targetLabel.trim().length > 0 &&
    [...value.targetLabel].length <= 256 &&
    value.facts.length <= 8 &&
    value.facts.every((fact) => fact.trim().length > 0 && [...fact].length <= 512)
  );
}

export function validateConversationResponseRequest(
  options: ManagedConversationResponderOptions,
  input: ManagedConversationResponseRequest,
  plan: ManagedConversationResponsePlan,
): void {
  if (
    input.decision.action !== "respond" ||
    input.event.eventId !== input.decision.eventId ||
    input.decision.projectId !== options.projectId ||
    input.policy.policyId !== input.decision.policyId ||
    input.policy.roleId !== input.decision.roleId ||
    !validCompletedEffect(input.context?.completedEffect)
  ) {
    throw new ManagedConversationResponseError(
      "invalid_response_request",
      "The conversation response decision is inconsistent with its event and policy.",
    );
  }
  validateConversationResponsePlan(options, input, plan);
}

export function validateConversationResponsePlan(
  options: Pick<ManagedConversationResponderOptions, "projectId">,
  input: Pick<ManagedConversationResponseRequest, "event" | "policy">,
  plan: ManagedConversationResponsePlan,
): void {
  const presentation = plan.role.outputContract.presentation;
  if (
    input.event.target.projectId !== options.projectId ||
    input.policy.projectId !== options.projectId ||
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
    (plan.deadlines?.providerTurnMs !== undefined &&
      (!Number.isSafeInteger(plan.deadlines.providerTurnMs) ||
        plan.deadlines.providerTurnMs < 1 ||
        plan.deadlines.providerTurnMs > 10 * 60_000)) ||
    (plan.executionIdentity.agentId !== null &&
      !/^agt_[a-f0-9]{24}$/u.test(plan.executionIdentity.agentId)) ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(plan.executionIdentity.provider) ||
    plan.executionIdentity.provider !== plan.adapter.descriptor.provider ||
    plan.executionIdentity.requestedModel !== plan.adapter.resourceAccounting.requestedModel ||
    (plan.executionIdentity.requestedModel !== null &&
      (plan.executionIdentity.requestedModel.length < 1 ||
        plan.executionIdentity.requestedModel.length > 128)) ||
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
    contextQualityPlanDigest: input.plan.contextQuality?.planDigest ?? null,
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
    completedEffect: input.request.context?.completedEffect ?? null,
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
  const governedDiscussionRequirements =
    input.event.coordination?.kind === "discussion.assignment"
      ? [
          "This is a governed discussion assignment. Produce this durable agent's independent, role- and context-grounded judgment only. An empty priorTurns list is intentional isolation, not a failure, and this participant must not claim to perform the coordinator's final synthesis.",
          "Treat injected repository and workstream status as historical context unless the current assignment supplies direct fresh observation. It may inform analysis, but do not assert that an old failure, blocker, deployment state, or verification result is still current without evidence from this turn.",
        ]
      : input.event.coordination?.kind === "discussion.contribution"
        ? [
            "This is a governed discussion synthesis. priorTurns contains the verified topic followed by earlier accepted contributions; message is the current accepted contribution. Compare all of them and produce one final decision.",
            "Attribute every contribution to its exact verified speaker. messageSpeaker identifies the current contribution and each prior turn carries its own speaker; never merge two participant or agent identities even when they share a role.",
            "Use discussion topic, accepted contributions, and the current message as the authority for this discussion's progress and completion state. Injected repository or workstream context may inform substance, but must not be presented as current discussion or deployment status unless an accepted contribution supplies direct evidence for that claim.",
          ]
        : [];
  const completedEffectRequirements =
    input.context?.completedEffect === undefined
      ? []
      : [
          "completedEffect is a trusted observation from an authorized action that already ran for this message. Respond from that result; do not propose running the action again or describe it as merely planned.",
          "Explain the result naturally in the message language and in the durable agent's own voice. Do not expose effect IDs, result codes, routing, or internal execution contracts unless the person explicitly asks for diagnostics.",
          "Use only completedEffect facts for claims about the action result. Keep the response proportional to the request and do not add generic operational caveats that the result does not require.",
        ];
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
      "When asked about identity, distinguish the durable agent from the turn provider. executionIdentity.requestedModel is configuration only; never present it as the provider-observed answer model.",
      "Write only the response body; do not send directly to an external platform.",
      ...governedDiscussionRequirements,
      ...completedEffectRequirements,
      `Keep the response at or below ${maximumResponseCharacters} Unicode characters.`,
    ],
    messageSpeaker: input.event.actor,
    priorTurns: input.context?.priorTurns ?? [],
    completedEffect: input.context?.completedEffect ?? null,
    message,
  });
}
