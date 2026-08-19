import type { ConversationPlatformIdentityPort } from "@lervo/conversation-platform";
import type {
  ConversationAdapterCapability,
  ConversationDeliveryReceipt,
  ConversationInboundEvent,
  ConversationOutboundMessage,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

export interface SlackSignedHttpRequest {
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Uint8Array;
}

export type SlackIngressResult =
  | { status: "accepted"; event: ConversationInboundEvent }
  | { status: "ignored"; reason: string }
  | { status: "challenge"; challenge: string };

export interface SlackDeliveryRequest {
  outboundId: string;
  teamId: string;
  channelId: string;
  threadTs: string | null;
  replyToTs: string | null;
  text: string;
  automationDepth: number;
  format: "plain";
}

export interface SlackDeliveryResult {
  messageTs: string;
  deliveredAt: string;
}

/**
 * Owns Slack OAuth authentication and Web API calls. It must return the same
 * messageTs when outboundId is retried, including after process restart.
 */
export interface SlackDeliveryPort {
  send(input: SlackDeliveryRequest): Promise<SlackDeliveryResult>;
}

export interface SlackConversationAdapterOptions {
  integrationId: string;
  apiAppId: string;
  allowedTeamIds: readonly string[];
  signingSecret: string;
  identity: ConversationPlatformIdentityPort;
  artifactStore: ArtifactStore;
  delivery: SlackDeliveryPort;
  capabilities?: readonly ConversationAdapterCapability[];
  now?: () => Date;
  maximumRequestBytes?: number;
}

export interface SlackConversationAdapterPort {
  receive(request: SlackSignedHttpRequest): Promise<SlackIngressResult>;
  deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt>;
}
