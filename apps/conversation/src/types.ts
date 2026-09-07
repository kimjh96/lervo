import type {
  DiscordConversationAdapter,
  DiscordGatewayAuthenticationPort,
} from "@lervo/adapter-discord";
import type { SlackConversationAdapter } from "@lervo/adapter-slack";
import type { ConversationAdapter } from "@lervo/conversation-contract";
import type {
  AuthenticatedDiscordGatewayDriver,
  DiscordGatewayDriverOptions,
} from "@lervo/discord-gateway";
import type {
  ConversationPublicationVerifier,
  ConversationRelevanceEvaluator,
  ConversationResponder,
} from "@lervo/interaction";
import type { ConversationParticipationPolicy } from "@lervo/schemas";
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
import type { ConversationInteractionResult } from "./interaction-runtime.js";

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
  gatewayAuthentication?: DiscordGatewayAuthenticationPort;
  gateway?: Omit<DiscordGatewayDriverOptions, "applicationId" | "botToken" | "onDispatch">;
}

export interface ConversationInteractionBinding {
  policy: ConversationParticipationPolicy;
  agentParticipantId: string;
  responder: ConversationResponder;
  publicationVerifier: ConversationPublicationVerifier;
  relevanceEvaluator?: ConversationRelevanceEvaluator;
}

export interface ConversationInteractionDeployment {
  bindings: readonly ConversationInteractionBinding[];
  workerId: string;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  deliveryLimit?: number;
  maxRecords?: number;
  now?: () => Date;
}

export interface ConversationApplicationOptions {
  dataDirectory: string;
  conversations: readonly ConversationPlatformConversationBinding[];
  participants: readonly ConversationPlatformParticipantBinding[];
  threads?: readonly ConversationPlatformThreadBinding[];
  slack?: readonly SlackConversationDeployment[];
  discord?: readonly DiscordConversationDeployment[];
  integrations?: readonly ConversationIntegrationDeployment[];
  interactions?: ConversationInteractionDeployment;
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
  discordGateways: ReadonlyMap<string, AuthenticatedDiscordGatewayDriver>;
  deliberations: ConversationDeliberationPort | null;
  handleInboundEvent:
    | ((
        event: import("@lervo/schemas").ConversationInboundEvent,
      ) => Promise<ConversationInteractionResult[]>)
    | null;
  runDeliveryCycle:
    | ((
        integrationId: string,
      ) => Promise<import("@lervo/interaction").ConversationDeliveryCycleResult>)
    | null;
  runDeliberationWorkerCycle(): Promise<ConversationDeliberationWorkerCycleResult>;
  runDeliberationResumeWorkerCycle(): Promise<ConversationDeliberationResumeWorkerCycleResult>;
  reconcileDeliberation:
    | ((input: {
        projectId: string;
        deliberationId: string;
      }) => Promise<ConversationDeliberationReconciliationResult>)
    | null;
  close(): void;
}
