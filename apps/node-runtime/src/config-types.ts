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
}
