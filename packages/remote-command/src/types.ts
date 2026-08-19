import {
  type RemoteCommand,
  type RemoteCommandExecutionReceipt,
  type RemoteCommandPayloadReference,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
} from "@lervo/schemas";

export interface RemoteCommandClock {
  now(): string;
}

export interface TrustedRemoteCommandSigner {
  keyId: string;
  projects: RemoteCommandTarget[];
  verify(input: { message: Uint8Array; signature: Uint8Array }): Promise<boolean>;
}

export interface RemoteCommandTrustStore {
  find(keyId: string): Promise<TrustedRemoteCommandSigner | null>;
}

export type RemoteCommandPolicyDecision =
  | { status: "approved" }
  | { status: "denied"; reasonCode: string };

export interface RemoteCommandPolicy {
  authorize(input: {
    command: RemoteCommand;
    signerKeyId: string;
    evaluatedAt: string;
  }): Promise<RemoteCommandPolicyDecision>;
}

export interface RemoteCommandPayloadLoader {
  load(reference: RemoteCommandPayloadReference): Promise<Uint8Array>;
}

export interface RemoteCommandExecutor {
  execute(input: {
    command: RemoteCommand;
    request: string;
    authorizedAt: string;
  }): Promise<{ runId: string; completedAt: string }>;
}

export interface RemoteCommandReplayCoordinate {
  commandHash: string;
  idempotencyKey: string;
  nonce: string;
}

export type RemoteCommandReplayDecision =
  | { status: "available" }
  | { status: "duplicate"; receipt: RemoteCommandExecutionReceipt }
  | { status: "in_progress" }
  | { status: "idempotency_conflict" }
  | { status: "nonce_replay" };

export type RemoteCommandReservationDecision =
  | { status: "reserved"; reservationId: string }
  | Exclude<RemoteCommandReplayDecision, { status: "available" }>;

export interface RemoteCommandReplayStore {
  inspect(coordinate: RemoteCommandReplayCoordinate): Promise<RemoteCommandReplayDecision>;
  reserve(coordinate: RemoteCommandReplayCoordinate): Promise<RemoteCommandReservationDecision>;
  complete(input: {
    reservationId: string;
    receipt: RemoteCommandExecutionReceipt;
  }): Promise<void>;
}

export interface RemoteCommandHandlingResult {
  deliveryStatus: "processed" | "duplicate";
  receipt: RemoteCommandExecutionReceipt;
}

export interface RemoteCommandReceiverOptions {
  target: RemoteCommandTarget;
  trustStore: RemoteCommandTrustStore;
  replayStore: RemoteCommandReplayStore;
  policy: RemoteCommandPolicy;
  payloadLoader: RemoteCommandPayloadLoader;
  executor: RemoteCommandExecutor;
  clock?: RemoteCommandClock;
  maxLifetimeMs?: number;
  clockSkewMs?: number;
}

export interface RemoteCommandHandler {
  handle(envelope: SignedRemoteCommand): Promise<RemoteCommandHandlingResult>;
}
