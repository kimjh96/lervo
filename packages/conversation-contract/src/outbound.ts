import { canonicalJson } from "@lervo/event-contract";
import {
  type ConversationAdapterDescriptor,
  type ConversationDeliveryReceipt,
  type ConversationInboundEvent,
  type ConversationOutboundMessage,
  type ConversationParticipationPolicy,
  validateSchema,
} from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";

import { ConversationContractError } from "./errors.js";
import { clone, digest } from "./shared.js";

type OutboundContent = Omit<ConversationOutboundMessage, "outboundId">;

export function assertConversationAdapterDescriptor(
  descriptor: ConversationAdapterDescriptor,
): void {
  if (!validateSchema("conversationAdapterDescriptor", descriptor).valid) {
    throw new ConversationContractError(
      "invalid_adapter_descriptor",
      "The conversation adapter descriptor is invalid.",
    );
  }
}

export function calculateConversationOutboundId(content: OutboundContent): string {
  return `cvo_${digest(canonicalJson(clone(content))).slice("sha256:".length)}`;
}

export function createConversationOutboundMessage(input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  participantId: string;
  agentBinding?: ConversationOutboundMessage["actor"]["agentBinding"];
  content: ConversationOutboundMessage["content"];
  publicationPermit: ConversationOutboundMessage["publicationPermit"];
  deliveryRelation?: "standalone" | "reply";
  createdAt: string;
}): ConversationOutboundMessage {
  const content: OutboundContent = {
    schemaVersion: 1,
    sourceEventId: input.event.eventId,
    policyId: input.policy.policyId,
    target: clone(input.event.target),
    actor: {
      kind: "agent",
      participantId: input.participantId,
      roleId: input.policy.roleId,
      ...(input.agentBinding === undefined ? {} : { agentBinding: clone(input.agentBinding) }),
    },
    content: clone(input.content),
    publicationPermit: clone(input.publicationPermit),
    deliveryRelation: input.deliveryRelation ?? "standalone",
    automationDepth: input.event.automationDepth + 1,
    createdAt: input.createdAt,
  };
  const outbound = {
    ...content,
    outboundId: calculateConversationOutboundId(content),
  };
  assertConversationOutboundMessage({
    outbound,
    event: input.event,
    policy: input.policy,
  });
  return clone(outbound);
}

export function assertConversationOutboundMessage(input: {
  outbound: ConversationOutboundMessage;
  event?: ConversationInboundEvent;
  policy?: ConversationParticipationPolicy;
}): void {
  const { outbound } = input;
  if (!validateSchema("conversationOutboundMessage", outbound).valid) {
    throw new ConversationContractError(
      "invalid_outbound_message",
      "The conversation outbound message contract is invalid.",
    );
  }
  const { outboundId: _outboundId, ...content } = outbound;
  if (
    outbound.outboundId !== calculateConversationOutboundId(content) ||
    outbound.publicationPermit.surface !== "chat" ||
    outbound.publicationPermit.permitId !==
      calculateWritingPublicationPermitId(outbound.publicationPermit) ||
    outbound.publicationPermit.artifactId !== outbound.content.artifactId ||
    outbound.publicationPermit.contentHash !== outbound.content.contentHash ||
    Date.parse(outbound.createdAt) < Date.parse(outbound.publicationPermit.issuedAt) ||
    (input.event !== undefined &&
      (outbound.sourceEventId !== input.event.eventId ||
        outbound.target.integrationId !== input.event.target.integrationId ||
        outbound.target.projectId !== input.event.target.projectId ||
        outbound.target.conversationId !== input.event.target.conversationId ||
        outbound.target.threadId !== input.event.target.threadId ||
        outbound.automationDepth !== input.event.automationDepth + 1 ||
        Date.parse(outbound.createdAt) < Date.parse(input.event.occurredAt))) ||
    (input.policy !== undefined &&
      (outbound.policyId !== input.policy.policyId ||
        outbound.actor.roleId !== input.policy.roleId))
  ) {
    throw new ConversationContractError(
      "invalid_outbound_message",
      "The conversation outbound ID, publication permit, or source coordinates differ.",
    );
  }
}

export function assertConversationDeliveryReceipt(input: {
  receipt: ConversationDeliveryReceipt;
  outbound: ConversationOutboundMessage;
  descriptor: ConversationAdapterDescriptor;
}): void {
  if (
    !validateSchema("conversationDeliveryReceipt", input.receipt).valid ||
    input.receipt.outboundId !== input.outbound.outboundId ||
    input.receipt.integrationId !== input.outbound.target.integrationId ||
    input.receipt.integrationId !== input.descriptor.integrationId
  ) {
    throw new ConversationContractError(
      "invalid_delivery_receipt",
      "The conversation delivery receipt coordinates differ from the source.",
    );
  }
}

export interface ConversationAdapter {
  readonly descriptor: ConversationAdapterDescriptor;
  deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt>;
}
