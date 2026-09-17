import { createHash } from "node:crypto";

import {
  assertConversationAdapterDescriptor,
  assertConversationDeliveryReceipt,
  assertConversationOutboundMessage,
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type {
  ConversationAdapterDescriptor,
  ConversationDeliveryReceipt,
  ConversationInboundEvent,
  ConversationOutboundMessage,
} from "@lervo/schemas";

import { NativeChatAdapterError } from "./errors.js";
import type {
  NativeChatAdapterOptions,
  NativeChatDeliveryPort,
  NativeChatInboundEnvelope,
} from "./types.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function assertSecretKey(value: string, label: string): void {
  if (value.length < 1 || value.length > 512) {
    throw new NativeChatAdapterError(
      "invalid_native_chat_configuration",
      `${label} length is invalid.`,
    );
  }
}

export class NativeChatConversationAdapter {
  readonly descriptor: ConversationAdapterDescriptor;
  private readonly delivery: NativeChatDeliveryPort;

  constructor(options: NativeChatAdapterOptions) {
    assertSecretKey(options.instanceIdentity, "Native chat instance identity");
    const capabilities = [
      ...(options.capabilities ?? ["messages.receive", "messages.send", "threads"]),
    ].sort();
    this.descriptor = {
      schemaVersion: 1,
      integrationId: options.integrationId,
      adapterKind: "native",
      instanceIdentityHash: digest(options.instanceIdentity),
      capabilities,
    };
    assertConversationAdapterDescriptor(this.descriptor);
    this.delivery = options.delivery;
  }

  normalizeInbound(envelope: NativeChatInboundEnvelope): ConversationInboundEvent {
    if (!this.descriptor.capabilities.includes("messages.receive")) {
      throw new NativeChatAdapterError(
        "unsupported_native_chat_capability",
        "The native chat adapter does not support message reception.",
      );
    }
    try {
      return createConversationInboundEvent({
        sourceEventKeyHash: hashConversationSourceEventKey(envelope.sourceEventKey),
        target: {
          integrationId: this.descriptor.integrationId,
          ...structuredClone(envelope.target),
        },
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
    } catch (error) {
      throw new NativeChatAdapterError(
        "invalid_native_chat_event",
        "The native chat inbound event could not be normalized.",
        { cause: error },
      );
    }
  }

  async deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt> {
    if (!this.descriptor.capabilities.includes("messages.send")) {
      throw new NativeChatAdapterError(
        "unsupported_native_chat_capability",
        "The native chat adapter does not support message delivery.",
      );
    }
    try {
      assertConversationOutboundMessage({ outbound: message });
      if (message.target.integrationId !== this.descriptor.integrationId) {
        throw new Error("integration mismatch");
      }
      const delivered = await this.delivery.send(structuredClone(message));
      assertSecretKey(delivered.deliveryKey, "Native chat delivery key");
      if (
        !Number.isFinite(Date.parse(delivered.deliveredAt)) ||
        Date.parse(delivered.deliveredAt) < Date.parse(message.createdAt)
      )
        throw new Error("invalid delivery timestamp");
      const receipt: ConversationDeliveryReceipt = {
        schemaVersion: 1,
        outboundId: message.outboundId,
        integrationId: this.descriptor.integrationId,
        deliveryKeyHash: digest(delivered.deliveryKey),
        deliveredAt: delivered.deliveredAt,
      };
      assertConversationDeliveryReceipt({
        receipt,
        outbound: message,
        descriptor: this.descriptor,
      });
      return receipt;
    } catch (error) {
      throw new NativeChatAdapterError(
        "native_chat_delivery_failed",
        "The native chat message could not be delivered.",
        { cause: error },
      );
    }
  }
}
