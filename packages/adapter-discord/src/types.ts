import type { ConversationPlatformIdentityPort } from "@lervo/conversation-platform";
import type {
  ConversationAdapterCapability,
  ConversationDeliveryReceipt,
  ConversationInboundEvent,
  ConversationOutboundMessage,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

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

export interface DiscordDeliveryRequest {
  outboundId: string;
  guildId: string | null;
  channelId: string;
  replyToMessageId: string | null;
  content: string;
  automationDepth: number;
  allowedMentions: "none";
  enforceIdempotency: true;
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

export interface DiscordConversationAdapterOptions {
  integrationId: string;
  applicationId: string;
  allowedGuildIds: readonly string[];
  allowDirectMessages: boolean;
  gatewayAuthentication: DiscordGatewayAuthenticationPort;
  identity: ConversationPlatformIdentityPort;
  artifactStore: ArtifactStore;
  delivery: DiscordDeliveryPort;
  capabilities?: readonly ConversationAdapterCapability[];
  now?: () => Date;
  maximumGatewayPayloadBytes?: number;
}

export type DiscordIngressResult =
  | { status: "accepted"; event: ConversationInboundEvent }
  | { status: "ignored"; reason: string };

export interface DiscordConversationAdapterPort {
  receiveGatewayDispatch(input: DiscordGatewayDispatch): Promise<DiscordIngressResult>;
  deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt>;
}
