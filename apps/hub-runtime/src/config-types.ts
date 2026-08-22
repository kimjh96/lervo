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
    host: "127.0.0.1" | "::1";
    port: number;
  };
  storage: {
    databasePath: string;
    commandCasPath: string;
  };
  identity: {
    hubIdentityHash: string;
  };
  credentials: HubBearerCredential[];
  signing: {
    policy: HubRuntimeSigningConfig;
    command: HubRuntimeSigningConfig;
  };
  control: {
    reviewGrantSecretPath: string;
    reviewGrantTtlSeconds?: number;
  };
  cleanup: HubRuntimeCleanupConfig;
}
