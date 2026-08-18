import { type EventDraft, type RedactionRecord } from "@roven/event-contract";
import { type EventEnvelope } from "@roven/schemas";

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

/**
 * The callback must be synchronous. A provider may extend the transaction with
 * outbox operations while preserving one commit boundary.
 */
export interface EventStore<TTransaction extends EventStoreTransaction = EventStoreTransaction> {
  append(draft: EventDraft): AppendEventResult;
  transact<T>(work: (transaction: TTransaction) => T): T;
  get(eventId: string): EventEnvelope | null;
  list(options?: ListEventsOptions): EventEnvelope[];
  verifyIntegrity(): EventChainReport;
  close(): void;
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
