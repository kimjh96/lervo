import {
  type EventSyncCursor,
  type ProjectManifest,
  type ProjectRegistrationResponse,
} from "@lervo/schemas";
import { type OutboxStore } from "@lervo/storage-contract";

import { type AuthenticatedHubTransport } from "./transport.js";

export type SyncRetryFailureCode =
  | "hub_unavailable"
  | "transport_authentication_failed"
  | "invalid_registration_response"
  | "invalid_sync_ack"
  | "local_batch_invalid";

export interface SyncClock {
  now(): string;
}

export interface OutboundSyncWorkerOptions {
  store: OutboxStore;
  transport: AuthenticatedHubTransport;
  manifest: ProjectManifest;
  destinationId: string;
  expectedPeerIdentityHash: string;
  workerId: string;
  clock?: SyncClock;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  batchLimit?: number;
}

interface CycleBase {
  registrationStatus: ProjectRegistrationResponse["status"];
  cursor: EventSyncCursor;
  claimedCount: number;
  acknowledgedCount: number;
  rescheduledCount: number;
  acknowledgedBatchCount: number;
}

export type SyncCycleResult =
  | (CycleBase & { status: "idle"; claimedCount: 0 })
  | (CycleBase & { status: "synchronized" })
  | (CycleBase & {
      status: "retry_scheduled";
      failureCode: SyncRetryFailureCode;
      nextAttemptAt: string;
    })
  | {
      status: "registration_deferred";
      failureCode: Exclude<SyncRetryFailureCode, "invalid_sync_ack" | "local_batch_invalid">;
      nextAttemptAt: string;
      claimedCount: 0;
      acknowledgedCount: 0;
      rescheduledCount: 0;
      acknowledgedBatchCount: 0;
    };
