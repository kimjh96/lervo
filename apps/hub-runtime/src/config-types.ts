import type { HubBearerCredential } from "@lervo/hub";

export interface HubRuntimeSigningConfig {
  keyId: string;
  privateKeyPath: string;
}

export interface HubRuntimeCleanupConfig {
  workerId: string;
  leaseDurationMs?: number;
  cycleIntervalMs?: number;
  continuationDelayMs?: number;
  retryDelayMs?: number;
  orphanGraceMs?: number;
  limit?: number;
  maximumScannedObjects?: number;
}

export interface HubRuntimeConfig {
  schemaVersion: 1;
  listen: {
    host: string;
    port: number;
  };
  tls?: {
    certificatePath: string;
    privateKeyPath: string;
  };
  storage: {
    databasePath: string;
    commandCasPath: string;
  };
  identity: {
    hubIdentityHash: string;
  };
  credentials?: HubBearerCredential[];
  credentialsFile?: string;
  signing?: {
    policy: HubRuntimeSigningConfig;
    command: HubRuntimeSigningConfig;
  };
  signingFile?: string;
  control: {
    reviewGrantSecretPath: string;
    reviewGrantTtlSeconds?: number;
  };
  cleanup: HubRuntimeCleanupConfig;
}
