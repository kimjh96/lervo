import type { NodeSupervisionStartupConfiguration } from "./supervision-startup-config.js";
export interface NodeRuntimeConfig {
  schemaVersion: 1;
  repositoryRoot: string;
  hub: {
    baseUrl: string;
    bearerTokenFile: string;
    destinationId: string;
    hubIdentityHash: string;
  };
  sync: {
    workerId: string;
    idlePollIntervalMs?: number;
    leaseDurationMs?: number;
    retryDelayMs?: number;
    batchLimit?: number;
    requestTimeoutMs?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
  };
  organizationCredentials?: {
    nodeId: string;
  };
  workspaceCoordination?: {
    mode: "hub_coordinated";
    nodeId: string;
  };
  repositoryReplica?: {
    required: true;
    maximumStalenessMs: number;
    waitTimeoutMs: number;
    pollIntervalMs: number;
  };
  outcomeSupervision?: NodeSupervisionStartupConfiguration;
  discordConversation?: NodeDiscordConversationConfig;
  discordConversations?: NodeDiscordConversationConfig[];
  remoteCommands?: {
    nodeId: string;
    trustFile?: string;
    commandKeys?: Array<{
      keyId: string;
      publicKeyFile: string;
    }>;
    policyKeys?: Array<{
      keyId: string;
      publicKeyFile: string;
      purposes: Array<"snapshot" | "approval" | "revocation">;
    }>;
    providerHost?: {
      providers: Array<"codex" | "claude">;
      roles: string[];
      developerSkills: string[];
      executables?: Partial<Record<"codex" | "claude", string>>;
      models?: Partial<Record<"codex" | "claude", string>>;
      reasoningEfforts?: Partial<
        Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
      >;
    };
    idlePollIntervalMs?: number;
    leaseDurationMs?: number;
    retryDelayMs?: number;
    limit?: number;
    requestTimeoutMs?: number;
    maxResponseBytes?: number;
    maxLifetimeMs?: number;
    clockSkewMs?: number;
  };
}

export interface NodeDiscordConversationConfig {
  integrationId: string;
  applicationId: string;
  botTokenFile: string;
  intents: number;
  allowedGuildIds: string[];
  allowDirectMessages: boolean;
  workerId: string;
  agentParticipantId: string;
  agentId?: string;
  speaker?:
    | { kind: "bot" }
    | {
        kind: "webhook";
        webhooks: Array<{
          channelId: string;
          webhookId: string;
          tokenFile: string;
        }>;
        avatarUrl?: string;
      };
  organization?: {
    organizationId: string;
    teamId: string;
  };
  conversations: Array<{
    tenantKey: string;
    conversationKey: string;
    conversationId: string;
  }>;
  participants: Array<{
    tenantKey: string;
    userId: string;
    participantId: string;
    actorKind: "human" | "agent";
    roleId: string | null;
    startsAutomationChain?: boolean;
    mayRequestEffects?: boolean;
  }>;
  peerAgents?: Array<{
    participantKeys: string[];
    participantId: string;
    roleId: string;
    agentBinding: {
      agentId: string;
      roleVersion: string;
      roleContractHash: string;
      roleProfileHash: string;
    };
    tenantKeys: string[];
    conversationIds: string[];
  }>;
  administration?: {
    allowedActions: Array<
      | "current_member.nickname.set"
      | "guild_text_channel.create"
      | "public_thread.create"
      | "incoming_webhook.create"
      | "workforce.agent.hire"
    >;
    webhookCredentialDirectory?: string;
  };
  routing?: {
    readOnlyRoleId: string;
    workTimeoutMs?: number;
    intent?: {
      provider: "codex" | "claude";
      model?: string;
      timeoutMs?: number;
    };
    response: {
      provider: "codex" | "claude";
      model?: string;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
      timeoutMs?: number;
    };
    evaluation?: {
      provider: "codex" | "claude";
      model?: string;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
    };
  };
  command: {
    roleId: string;
    provider: "codex" | "claude";
    risk: "low" | "medium" | "high";
    verificationSuiteIds: string[];
    lifetimeMs: number;
    assignmentId: string | null;
    agentId: string | null;
  };
  gateway?: {
    url?: string;
    reconnectDelayMs?: number;
    maximumPayloadBytes?: number;
    maximumDispatchRecords?: number;
  };
  http?: {
    requestTimeoutMs?: number;
    maxResponseBytes?: number;
  };
  policy?: {
    mode?: "mention_only" | "relevant" | "proactive" | "silent";
    respondTo?: Array<"human" | "agent" | "system">;
    unaddressedHumanMessages?: "evaluate" | "respond";
    signalCodes?: string[];
    cooldownSeconds?: number;
    maxResponsesPerHour?: number;
    maxAutomationDepth?: number;
    maxResponseAttempts?: number;
  };
  repositorySignals?: {
    pollIntervalMs?: number;
    mappings: Array<{
      eventType: string;
      signalCode: string;
      conversationIds?: string[];
    }>;
  };
  deliberation?: {
    cliExecutable: string;
    workerId: string;
    defaultPolicyId?: string;
    principals: Array<{
      participantId: string;
      principalId: string;
      permissions: Array<"deliberation.start" | "deliberation.resume" | "deliberation.read">;
    }>;
    pollIntervalMs?: number;
    leaseDurationMs?: number;
    maxRecords?: number;
    processTimeoutMs?: number;
    notificationConversationIds?: string[];
    maximumReconciliationAttempts?: number;
  };
}
