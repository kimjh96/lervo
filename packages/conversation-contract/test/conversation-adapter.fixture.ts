import { createHash } from "node:crypto";

import {
  assertConversationAdapterDescriptor,
  assertConversationDeliveryReceipt,
  assertConversationOutboundMessage,
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type {
  ConversationAdapterCapability,
  ConversationAdapterDescriptor,
  ConversationContentReference,
  ConversationDeliveryReceipt,
  ConversationInboundEvent,
  ConversationOutboundMessage,
  ConversationTarget,
} from "@lervo/schemas";

export interface TestConversationInboundEnvelope {
  sourceEventKey: string;
  target: Omit<ConversationTarget, "integrationId">;
  kind: ConversationInboundEvent["kind"];
  actor: ConversationInboundEvent["actor"];
  content: ConversationContentReference;
  mentions?: ConversationInboundEvent["mentions"];
  replyToEventId?: string | null;
  signalCode?: string | null;
  audienceParticipation?: ConversationInboundEvent["audienceParticipation"];
  automationDepth?: number;
  occurredAt: string;
}

export interface TestConversationAdapterOptions {
  integrationId: string;
  instanceIdentity: string;
  delivery: {
    send(message: ConversationOutboundMessage): Promise<{
      deliveryKey: string;
      deliveredAt: string;
    }>;
  };
  capabilities?: readonly ConversationAdapterCapability[];
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/**
 * Platform-neutral conversation adapter for tests. It normalizes inbound envelopes and
 * records delivery receipts through the shared conversation contract, so stores and
 * runtimes can be exercised without a real chat platform.
 */
export class TestConversationAdapter {
  readonly descriptor: ConversationAdapterDescriptor;
  private readonly delivery: TestConversationAdapterOptions["delivery"];

  constructor(options: TestConversationAdapterOptions) {
    this.descriptor = {
      schemaVersion: 1,
      integrationId: options.integrationId,
      adapterKind: "native",
      instanceIdentityHash: digest(options.instanceIdentity),
      capabilities: [
        ...(options.capabilities ?? ["messages.receive", "messages.send", "threads"]),
      ].sort(),
    };
    assertConversationAdapterDescriptor(this.descriptor);
    this.delivery = options.delivery;
  }

  normalizeInbound(envelope: TestConversationInboundEnvelope): ConversationInboundEvent {
    return createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey(envelope.sourceEventKey),
      target: { integrationId: this.descriptor.integrationId, ...structuredClone(envelope.target) },
      kind: envelope.kind,
      actor: structuredClone(envelope.actor),
      content: structuredClone(envelope.content),
      mentions: structuredClone(envelope.mentions ?? { roleIds: [], participantIds: [] }),
      replyToEventId: envelope.replyToEventId ?? null,
      signalCode: envelope.signalCode ?? null,
      ...(envelope.audienceParticipation === undefined
        ? {}
        : { audienceParticipation: envelope.audienceParticipation }),
      automationDepth: envelope.automationDepth ?? 0,
      occurredAt: envelope.occurredAt,
    });
  }

  async deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt> {
    assertConversationOutboundMessage({ outbound: message });
    if (message.target.integrationId !== this.descriptor.integrationId) {
      throw new Error("The outbound message targets another integration.");
    }
    const delivered = await this.delivery.send(structuredClone(message));
    if (Date.parse(delivered.deliveredAt) < Date.parse(message.createdAt)) {
      throw new Error("The delivery timestamp precedes the outbound message.");
    }
    const receipt: ConversationDeliveryReceipt = {
      schemaVersion: 1,
      outboundId: message.outboundId,
      integrationId: this.descriptor.integrationId,
      deliveryKeyHash: digest(delivered.deliveryKey),
      deliveredAt: delivered.deliveredAt,
    };
    assertConversationDeliveryReceipt({ receipt, outbound: message, descriptor: this.descriptor });
    return receipt;
  }
}
