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
