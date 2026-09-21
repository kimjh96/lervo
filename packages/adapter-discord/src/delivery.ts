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

const maximumDiscordMessageCharacters = 2_000;

function discordContentProjection(
  content: string,
  audienceParticipation: "eligible" | "observe_only",
): string {
  const characters = [...content];
  if (characters.length <= maximumDiscordMessageCharacters) return content;
  if (audienceParticipation !== "observe_only") {
    throw new Error("Discord delivery content exceeds the platform limit");
  }
  const suffix = /\p{Script=Hangul}/u.test(content)
    ? "\n\n… 전체 내용은 Lervo의 기록과 통합 검색에서 확인할 수 있습니다."
    : "\n\n… The complete contribution remains available in Lervo records and unified search.";
  const suffixCharacters = [...suffix];
  return `${characters
    .slice(0, maximumDiscordMessageCharacters - suffixCharacters.length)
    .join("")
    .trimEnd()}${suffix}`;
}

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
    const [sourceContent, address] = await Promise.all([
      readConversationOutboundText({ message: input.message, artifactStore: input.artifactStore }),
      input.identity.mapOutbound({
        platform: "discord",
        integrationId: input.descriptor.integrationId,
        target: input.message.target,
        actor: input.message.actor,
        sourceEventId: input.message.sourceEventId,
        ...(input.message.replyToEventId === undefined
          ? {}
          : { replyToEventId: input.message.replyToEventId }),
      }),
    ]);
    const content = discordContentProjection(
      sourceContent,
      input.message.audienceParticipation ?? "eligible",
    );
    const guildId = address.tenantKey === "dm" ? null : address.tenantKey;
    if (
      [...content].length > maximumDiscordMessageCharacters ||
      (guildId === null && !input.allowDirectMessages) ||
      (guildId !== null && !input.allowedGuildIds.has(guildId))
    )
      throw new Error("Discord delivery scope or content limit mismatch");
    const delivered = await input.delivery.send({
      outboundId: input.message.outboundId,
      guildId,
      channelId: address.conversationKey,
      threadId: address.threadKey,
      replyToMessageId:
        input.message.deliveryRelation === "reply" ? address.replyToMessageKey : null,
      content,
      automationDepth: input.message.automationDepth,
      audienceParticipation: input.message.audienceParticipation ?? "eligible",
      ...(input.message.coordination === undefined
        ? {}
        : { coordination: input.message.coordination }),
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
