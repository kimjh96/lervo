import type {
  DiscordConversationAdapter,
  DiscordGatewayAuthenticationPort,
} from "@lervo/adapter-discord";
import type { SlackConversationAdapter } from "@lervo/adapter-slack";
import type {
  ConversationPlatformConversationBinding,
  ConversationPlatformParticipantBinding,
  ConversationPlatformThreadBinding,
} from "@lervo/conversation-platform-sqlite";

interface PlatformCredentialTransportOptions {
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface SlackConversationDeployment extends PlatformCredentialTransportOptions {
  integrationId: string;
  apiAppId: string;
  allowedTeamIds: readonly string[];
  signingSecret: string;
  botToken: string;
}

export interface DiscordConversationDeployment extends PlatformCredentialTransportOptions {
  integrationId: string;
  applicationId: string;
  allowedGuildIds: readonly string[];
  allowDirectMessages: boolean;
  botToken: string;
  gatewayAuthentication: DiscordGatewayAuthenticationPort;
}

export interface ConversationApplicationOptions {
  dataDirectory: string;
  conversations: readonly ConversationPlatformConversationBinding[];
  participants: readonly ConversationPlatformParticipantBinding[];
  threads?: readonly ConversationPlatformThreadBinding[];
  slack?: readonly SlackConversationDeployment[];
  discord?: readonly DiscordConversationDeployment[];
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}

export interface ConversationApplication {
  slackAdapters: ReadonlyMap<string, SlackConversationAdapter>;
  discordAdapters: ReadonlyMap<string, DiscordConversationAdapter>;
  close(): void;
}
