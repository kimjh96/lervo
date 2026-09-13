import type { ConversationPlatformIdentityPort } from "@lervo/conversation-platform";
import type {
  ConversationAdapterCapability,
  ConversationDeliveryReceipt,
  ConversationInboundEvent,
  ConversationOutboundMessage,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { DiscordGoalInteraction } from "./goal-interaction.js";

export interface DiscordGatewayDispatch {
  sessionHandle: string;
  body: Uint8Array;
}

export interface DiscordGatewayAuthenticationPort {
  /**
   * Confirms an Identify/Ready or Resume authenticated bot session and its
   * sequence. Heartbeat, reconnect and replay-window state stay in this port.
   */
  verifyDispatch(input: {
    sessionHandle: string;
    applicationId: string;
    sequence: number;
    eventName: string;
    verifiedAt: string;
  }): Promise<{ authenticated: true } | { authenticated: false; reasonCode: string }>;
}

export interface DiscordHistoryMessage {
  /** Credential-authenticated Discord REST message payload. */
  messageId: string;
  body: Uint8Array;
}

export interface DiscordHistoryPort {
  list(input: {
    channelId: string;
    after: string | null;
    limit: number;
  }): Promise<readonly DiscordHistoryMessage[]>;
}

export interface DiscordIngressCheckpoint {
  tenantKey: string;
  channelId: string;
  messageId: string;
}

export interface DiscordDeliveryRequest {
  outboundId: string;
  guildId: string | null;
  channelId: string;
  threadId: string | null;
  replyToMessageId: string | null;
  content: string;
  automationDepth: number;
  allowedMentions: "none";
  enforceIdempotency: true;
}

export interface DiscordConversationAddressPort {
  /** Resolves an owned Gateway channel, or returns null when another channel owns the event. */
  resolve(input: {
    guildId: string | null;
    channelId: string;
  }): Promise<{ conversationKey: string; threadKey: string | null } | null>;
}

export interface DiscordDeliveryResult {
  messageId: string;
  deliveredAt: string;
}

/**
 * Owns bot-token REST authentication. It must use an enforced nonce or a
 * durable lookup so outboundId retries return one messageId after restart.
 */
export interface DiscordDeliveryPort {
  send(input: DiscordDeliveryRequest): Promise<DiscordDeliveryResult>;
}

export interface DiscordTypingLease {
  stop(): void;
}

export interface DiscordTypingPort {
  start(input: { channelId: string }): DiscordTypingLease;
}

export interface DiscordCurrentMemberUpdate {
  guildId: string;
  nickname: string | null;
}

export interface DiscordAdministrationPort {
  setCurrentMemberNickname(input: DiscordCurrentMemberUpdate): Promise<{
    guildId: string;
    applicationId: string;
    nickname: string | null;
    observedAt: string;
  }>;
  createGuildTextChannel(input: {
    guildId: string;
    name: string;
    topic: string | null;
    parentChannelId: string | null;
  }): Promise<{
    guildId: string;
    channelId: string;
    name: string;
    observedAt: string;
  }>;
  createPublicThread(input: {
    guildId: string;
    channelId: string;
    name: string;
    autoArchiveDuration: 60 | 1440 | 4320 | 10080;
  }): Promise<{
    guildId: string;
    parentChannelId: string;
    threadId: string;
    name: string;
    observedAt: string;
  }>;
  createIncomingWebhook(input: { guildId: string; channelId: string; name: string }): Promise<{
    guildId: string;
    channelId: string;
    webhookId: string;
    name: string;
    token: string;
    observedAt: string;
  }>;
  updateIncomingWebhook(input: {
    guildId: string;
    channelId: string;
    webhookId: string;
    name: string;
  }): Promise<{
    guildId: string;
    channelId: string;
    webhookId: string;
    name: string;
    observedAt: string;
  }>;
  deleteIncomingWebhook(input: { guildId: string; channelId: string; webhookId: string }): Promise<{
    guildId: string;
    channelId: string;
    webhookId: string;
    observedAt: string;
  }>;
}

export interface DiscordResponseActivity {
  start(): DiscordTypingLease;
}

export interface DiscordConversationAdapterOptions {
  integrationId: string;
  applicationId: string;
  allowedGuildIds: readonly string[];
  allowDirectMessages: boolean;
  gatewayAuthentication: DiscordGatewayAuthenticationPort;
  identity: ConversationPlatformIdentityPort;
  artifactStore: ArtifactStore;
  delivery: DiscordDeliveryPort;
  conversationAddress?: DiscordConversationAddressPort;
  deliveryIdentity?: string;
  ignoredParticipantKeys?: readonly string[];
  textualParticipantAliases?: readonly {
    displayName: string;
    participantKey: string;
  }[];
  typing?: DiscordTypingPort;
  capabilities?: readonly ConversationAdapterCapability[];
  now?: () => Date;
  maximumGatewayPayloadBytes?: number;
}

export type DiscordIngressResult =
  | {
      status: "accepted";
      event: ConversationInboundEvent;
      responseActivity: DiscordResponseActivity | null;
      checkpoint: DiscordIngressCheckpoint | null;
    }
  | { status: "goal_command"; command: DiscordGoalInteraction; checkpoint: null }
  | { status: "ignored"; reason: string; checkpoint: DiscordIngressCheckpoint | null };

export interface DiscordConversationAdapterPort {
  receiveGatewayDispatch(input: DiscordGatewayDispatch): Promise<DiscordIngressResult>;
  receiveHistoryMessage(
    input: DiscordHistoryMessage,
    expectedGuildId: string | null,
  ): Promise<DiscordIngressResult>;
  deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt>;
}
