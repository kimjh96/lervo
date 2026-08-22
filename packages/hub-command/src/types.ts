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
  envelope: SignedRemoteCommand;
  deliveryId: string;
  queuedAt: string;
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
