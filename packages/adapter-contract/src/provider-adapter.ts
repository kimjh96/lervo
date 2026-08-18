import {
  type AdapterContextEnvelope,
  type AdapterContextReceipt,
  type AdapterDescriptor,
  type AdapterNormalizedEvent,
  type AdapterSession,
  type AdapterStartRequest,
  type AdapterStopRequest,
  type AdapterStopResult,
} from "@roven/schemas";

export interface ProviderAdapter {
  readonly descriptor: AdapterDescriptor;

  start(request: AdapterStartRequest): Promise<AdapterSession>;
  injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt>;
  events(session: AdapterSession, signal: AbortSignal): AsyncIterable<AdapterNormalizedEvent>;
  stop(session: AdapterSession, request: AdapterStopRequest): Promise<AdapterStopResult>;
}

export interface AdapterContractFixture {
  expectedProvider: string;
  startRequest: AdapterStartRequest;
  contextEnvelope: AdapterContextEnvelope;
  stopReason: AdapterStopRequest["reason"];
  expectedEventCount?: number;
  eventTimeoutMs?: number;
}
