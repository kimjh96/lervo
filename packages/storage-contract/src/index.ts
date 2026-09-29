import { type EventDraft, type RedactionRecord } from "@lervo/event-contract";
import { type EventEnvelope } from "@lervo/schemas";

export * from "./event-reader.js";

export interface AppendEventResult {
  event: EventEnvelope;
  inserted: boolean;
  redactions: RedactionRecord[];
}

export interface ListEventsOptions {
  afterSeq?: number;
  limit?: number;
  runId?: string;
}

export interface EventChainReport {
  valid: true;
  eventCount: number;
  headHash: string | null;
}

export interface EventStoreTransaction {
  append(draft: EventDraft): AppendEventResult;
}

export interface EnqueueOutboxRequest {
  eventId: string;
  destinationId: string;
  enqueuedAt: string;
  availableAt?: string;
}

export interface EnqueueOutboxResult {
  inserted: boolean;
}

export interface ClaimOutboxRequest {
  workerId: string;
  claimedAt: string;
  leaseDurationMs: number;
  destinationId?: string;
  limit?: number;
}

export interface AcknowledgeOutboxRequest {
  eventId: string;
  destinationId: string;
  workerId: string;
  acknowledgedAt: string;
}

export interface AcknowledgeOutboxResult {
  acknowledged: boolean;
}

export interface RescheduleOutboxRequest {
  eventId: string;
  destinationId: string;
  workerId: string;
  failedAt: string;
  availableAt: string;
  failureCode: string;
}

export interface RescheduleOutboxResult {
  rescheduled: true;
}

export interface PurgeAcknowledgedOutboxRequest {
  before: string;
  limit?: number;
  destinationId?: string;
  keepMostRecent?: number;
}

export interface PurgeAcknowledgedOutboxResult {
  deleted: number;
}

export type OutboxStatus = "pending" | "leased" | "acknowledged";

export interface OutboxDelivery {
  event: EventEnvelope;
  destinationId: string;
  enqueuedAt: string;
  availableAt: string;
  attemptCount: number;
  status: OutboxStatus;
  lease: { workerId: string; claimedAt: string; expiresAt: string } | null;
  lastFailure: { code: string; failedAt: string } | null;
  acknowledgedAt: string | null;
}

export interface ListOutboxOptions {
  destinationId?: string;
  status?: OutboxStatus;
  limit?: number;
}

export interface OutboxTransaction extends EventStoreTransaction {
  enqueue(request: EnqueueOutboxRequest): EnqueueOutboxResult;
  outstandingCount(destinationId: string): number;
  claim(request: ClaimOutboxRequest): OutboxDelivery[];
  acknowledge(request: AcknowledgeOutboxRequest): AcknowledgeOutboxResult;
  reschedule(request: RescheduleOutboxRequest): RescheduleOutboxResult;
  purgeAcknowledged(request: PurgeAcknowledgedOutboxRequest): PurgeAcknowledgedOutboxResult;
}

/**
 * The callback must be synchronous. A provider may extend the transaction with
 * outbox operations while preserving one commit boundary.
 */
export interface EventStore<TTransaction extends EventStoreTransaction = EventStoreTransaction> {
  append(draft: EventDraft): AppendEventResult;
  transact<T>(work: (transaction: TTransaction) => T): T;
  get(eventId: string): EventEnvelope | null;
  latest(): EventEnvelope | null;
  list(options?: ListEventsOptions): EventEnvelope[];
  verifyIntegrity(): EventChainReport;
  close(): void;
}

export interface OutboxStore extends EventStore<OutboxTransaction> {
  enqueue(request: EnqueueOutboxRequest): EnqueueOutboxResult;
  outstandingCount(destinationId: string): number;
  claim(request: ClaimOutboxRequest): OutboxDelivery[];
  acknowledge(request: AcknowledgeOutboxRequest): AcknowledgeOutboxResult;
  reschedule(request: RescheduleOutboxRequest): RescheduleOutboxResult;
  purgeAcknowledged(request: PurgeAcknowledgedOutboxRequest): PurgeAcknowledgedOutboxResult;
  getOutbox(eventId: string, destinationId: string): OutboxDelivery | null;
  listOutbox(options?: ListOutboxOptions): OutboxDelivery[];
}

export interface ArtifactPutResult {
  uri: string;
  contentHash: string;
  byteCount: number;
  created: boolean;
}

export interface ArtifactStore {
  put(content: string | Uint8Array): Promise<ArtifactPutResult>;
  putStream(chunks: AsyncIterable<string | Uint8Array>): Promise<ArtifactPutResult>;
  get(uri: string): Promise<Uint8Array>;
  has(uri: string): Promise<boolean>;
}
