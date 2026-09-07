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
  discordConversation?: NodeDiscordConversationConfig;
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
  conversations: Array<{
    tenantKey: string;
    conversationKey: string;
    conversationId: string;
  }>;
  participants: Array<{
    tenantKey: string;
    userId: string;
    participantId: string;
  }>;
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
    cooldownSeconds?: number;
    maxResponsesPerHour?: number;
    maxAutomationDepth?: number;
  };
}
