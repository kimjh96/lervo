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

import type { DiscordDeliveryPort } from "./types.js";

export async function deliverDiscordConversationMessage(input: {
  descriptor: ConversationAdapterDescriptor;
  message: ConversationOutboundMessage;
  allowedGuildIds: ReadonlySet<string>;
  allowDirectMessages: boolean;
  identity: ConversationPlatformIdentityPort;
  artifactStore: ArtifactStore;
  delivery: DiscordDeliveryPort;
}): Promise<ConversationDeliveryReceipt> {
  try {
    if (input.message.target.integrationId !== input.descriptor.integrationId) {
      throw new Error("integration mismatch");
    }
    const [content, address] = await Promise.all([
      readConversationOutboundText({ message: input.message, artifactStore: input.artifactStore }),
      input.identity.mapOutbound({
        platform: "discord",
        integrationId: input.descriptor.integrationId,
        target: input.message.target,
        actor: input.message.actor,
      }),
    ]);
    const guildId = address.tenantKey === "dm" ? null : address.tenantKey;
    if (
      [...content].length > 2_000 ||
      (guildId === null && !input.allowDirectMessages) ||
      (guildId !== null && !input.allowedGuildIds.has(guildId))
    ) throw new Error("Discord delivery scope or content limit mismatch");
    const delivered = await input.delivery.send({
      outboundId: input.message.outboundId,
      guildId,
      channelId: address.conversationKey,
      replyToMessageId: address.replyToMessageKey,
      content,
      automationDepth: input.message.automationDepth,
      allowedMentions: "none",
      enforceIdempotency: true,
    });
    await input.identity.recordOutbound({
      platform: "discord",
      integrationId: input.descriptor.integrationId,
      tenantKey: address.tenantKey,
      conversationKey: address.conversationKey,
      outboundId: input.message.outboundId,
      sourceEventId: input.message.sourceEventId,
      externalMessageKey: delivered.messageId,
      automationDepth: input.message.automationDepth,
    });
    return createPlatformDeliveryReceipt({
      descriptor: input.descriptor,
      message: input.message,
      externalMessageKey: delivered.messageId,
      deliveredAt: delivered.deliveredAt,
    });
  } catch (error) {
    if (error instanceof ConversationPlatformError) throw error;
    throw new ConversationPlatformError(
      "platform_delivery_failed",
      "The Discord message could not be delivered safely.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
