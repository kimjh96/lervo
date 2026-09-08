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

export interface DiscordTypingLease {
  stop(): void;
}

export interface DiscordTypingPort {
  start(input: { channelId: string }): DiscordTypingLease;
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
      checkpoint: DiscordIngressCheckpoint;
    }
  | { status: "ignored"; reason: string; checkpoint: DiscordIngressCheckpoint | null };

export interface DiscordConversationAdapterPort {
  receiveGatewayDispatch(input: DiscordGatewayDispatch): Promise<DiscordIngressResult>;
  receiveHistoryMessage(
    input: DiscordHistoryMessage,
    expectedGuildId: string | null,
  ): Promise<DiscordIngressResult>;
  deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt>;
}
