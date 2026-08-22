import type {
  RemoteCommand,
  RemoteCommandPayloadReference,
  RemoteCommandTarget,
  SignedRemoteCommand,
} from "@lervo/schemas";

export interface HubCommandArtifactStore {
  put(content: Uint8Array): Promise<{
    uri: string;
    contentHash: string;
    byteCount: number;
    created: boolean;
  }>;
  get(uri: string): Promise<Uint8Array>;
}

export interface HubCommandArtifactInventoryItem {
  uri: string;
  byteCount: number;
  modifiedAt: string;
}

export interface HubCommandArtifactLifecycleStore extends HubCommandArtifactStore {
  listObjects(options?: {
    after?: string;
    limit?: number;
    maximumScannedObjects?: number;
  }): Promise<{
    items: HubCommandArtifactInventoryItem[];
    nextCursor: string | null;
  }>;
  deleteObject(uri: string): Promise<{ deleted: boolean }>;
}

export interface HubCommandSigner {
  readonly keyId: string;
  sign(command: RemoteCommand): SignedRemoteCommand;
}

export interface HubCommandAuthorshipRecord {
  destinationId: string;
  target: RemoteCommandTarget;
  idempotencyKey: string;
  submissionHash: string;
  authorSubjectHash: string;
  artifactUri: string;
  artifactRetainUntil: string;
  artifactLifecycleStatus: "retained" | "cleanup_claimed" | "purged";
  envelope: SignedRemoteCommand;
  deliveryId: string;
  queuedAt: string;
}

export type HubCommandArtifactPurgeKind = "expired" | "orphan";

export interface HubCommandArtifactPurgeClaim {
  claimId: string;
  kind: HubCommandArtifactPurgeKind;
  artifactUri: string;
  workerId: string;
  claimedAt: string;
  leaseExpiresAt: string;
  deliveryIds: string[];
}

export interface HubCommandArtifactLifecycleRepository {
  claimExpiredArtifacts(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<HubCommandArtifactPurgeClaim[]>;

  claimOrphanArtifact(input: {
    workerId: string;
    artifactUri: string;
    observedModifiedAt: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<HubCommandArtifactPurgeClaim | null>;

  completeArtifactPurge(input: {
    claimId: string;
    workerId: string;
    completedAt: string;
  }): Promise<{
    status: "completed" | "duplicate";
    kind: HubCommandArtifactPurgeKind;
    purgedDeliveryCount: number;
  }>;

  releaseArtifactPurgeClaim(input: {
    claimId: string;
    workerId: string;
    releasedAt: string;
  }): Promise<void>;
}

export interface HubCommandAuthoringStore {
  findAuthorship(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    idempotencyKey: string;
  }): Promise<HubCommandAuthorshipRecord | null>;

  commitAuthorship(input: HubCommandAuthorshipRecord): Promise<{
    status: "created" | "duplicate";
    record: HubCommandAuthorshipRecord;
  }>;

  findLeasedArtifact(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    nodeId: string;
    artifactId: string;
    requestedAt: string;
  }): Promise<{
    uri: string;
    reference: RemoteCommandPayloadReference;
  } | null>;
}

export interface AuthorHubCommandRequest {
  idempotencyKey: string;
  lifetimeMs: number;
  roleId: string;
  provider: string;
  risk: "low" | "medium" | "high";
  verificationSuiteIds: string[];
  request: string;
}
