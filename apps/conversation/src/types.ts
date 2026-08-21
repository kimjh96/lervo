import type {
  DiscordConversationAdapter,
  DiscordGatewayAuthenticationPort,
} from "@lervo/adapter-discord";
import type { SlackConversationAdapter } from "@lervo/adapter-slack";
import type { ConversationAdapter } from "@lervo/conversation-contract";
import type {
  ConversationDeliberationExecutionPort,
  ConversationDeliberationPort,
  ConversationDeliberationPrincipalBinding,
  ConversationDeliberationReconciliationResult,
  ConversationDeliberationReconciliationSourcePort,
  ConversationDeliberationResumeExecutionPort,
  ConversationDeliberationResumeWorkerCycleResult,
  ConversationDeliberationWorkerCycleResult,
} from "@lervo/conversation-control";
import type {
  ConversationPlatformConversationBinding,
  ConversationPlatformParticipantBinding,
  ConversationPlatformThreadBinding,
} from "@lervo/conversation-platform-sqlite";

import type { ConversationIntegrationDeployment } from "./integration.js";

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
  integrations?: readonly ConversationIntegrationDeployment[];
  deliberations?: {
    bindings: readonly ConversationDeliberationPrincipalBinding[];
    executor: ConversationDeliberationExecutionPort;
    reconciliationSource?: ConversationDeliberationReconciliationSourcePort;
    resumeExecutor?: ConversationDeliberationResumeExecutionPort;
    resumeWorkerId?: string;
    workerId: string;
    leaseDurationMs?: number;
    maxRecords?: number;
  };
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}

export interface ConversationApplication {
  adapters: ReadonlyMap<string, ConversationAdapter>;
  slackAdapters: ReadonlyMap<string, SlackConversationAdapter>;
  discordAdapters: ReadonlyMap<string, DiscordConversationAdapter>;
  deliberations: ConversationDeliberationPort | null;
  runDeliberationWorkerCycle(): Promise<ConversationDeliberationWorkerCycleResult>;
  runDeliberationResumeWorkerCycle(): Promise<ConversationDeliberationResumeWorkerCycleResult>;
  reconcileDeliberation: ((input: {
    projectId: string;
    deliberationId: string;
  }) => Promise<ConversationDeliberationReconciliationResult>) | null;
  close(): void;
}
