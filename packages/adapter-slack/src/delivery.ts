import {
  ConversationPlatformError,
  createPlatformDeliveryReceipt,
  readConversationOutboundText,
  type ConversationPlatformIdentityPort,
} from "@lervo/conversation-platform";
import type {
  ConversationAdapterDescriptor,
  ConversationDeliveryReceipt,
  ConversationOutboundMessage,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { SlackDeliveryPort } from "./types.js";

export async function deliverSlackConversationMessage(input: {
  descriptor: ConversationAdapterDescriptor;
  message: ConversationOutboundMessage;
  allowedTeamIds: ReadonlySet<string>;
  identity: ConversationPlatformIdentityPort;
  artifactStore: ArtifactStore;
  delivery: SlackDeliveryPort;
}): Promise<ConversationDeliveryReceipt> {
  try {
    if (input.message.target.integrationId !== input.descriptor.integrationId) {
      throw new Error("integration mismatch");
    }
    const [text, address] = await Promise.all([
      readConversationOutboundText({ message: input.message, artifactStore: input.artifactStore }),
      input.identity.mapOutbound({
        platform: "slack",
        integrationId: input.descriptor.integrationId,
        target: input.message.target,
        actor: input.message.actor,
      }),
    ]);
    if (!input.allowedTeamIds.has(address.tenantKey)) throw new Error("team scope mismatch");
    const delivered = await input.delivery.send({
      outboundId: input.message.outboundId,
      teamId: address.tenantKey,
      channelId: address.conversationKey,
      threadTs: address.threadKey,
      replyToTs: address.replyToMessageKey,
      text,
      automationDepth: input.message.automationDepth,
      format: "plain",
    });
    await input.identity.recordOutbound({
      platform: "slack",
      integrationId: input.descriptor.integrationId,
      outboundId: input.message.outboundId,
      externalMessageKey: delivered.messageTs,
      automationDepth: input.message.automationDepth,
    });
    return createPlatformDeliveryReceipt({
      descriptor: input.descriptor,
      message: input.message,
      externalMessageKey: delivered.messageTs,
      deliveredAt: delivered.deliveredAt,
    });
  } catch (error) {
    if (error instanceof ConversationPlatformError) throw error;
    throw new ConversationPlatformError(
      "platform_delivery_failed",
      "Slack message를 안전하게 전달하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
