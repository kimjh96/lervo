import {
  type AdapterContextEnvelope,
  type AdapterContextReceipt,
  type AdapterDescriptor,
  type AdapterNormalizedEvent,
  type AdapterSession,
  type AdapterStartRequest,
  type AdapterStopRequest,
  type AdapterStopResult,
  type AdapterTurn,
  type AdapterTurnResult,
  type AdapterTurnRequest,
} from "@roven/schemas";

export interface ProviderAdapter {
  readonly descriptor: AdapterDescriptor;

  start(request: AdapterStartRequest): Promise<AdapterSession>;
  injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt>;
  startTurn(session: AdapterSession, request: AdapterTurnRequest): Promise<AdapterTurn>;
  events(session: AdapterSession, signal: AbortSignal): AsyncIterable<AdapterNormalizedEvent>;
  getTurnResult(session: AdapterSession, turn: AdapterTurn): Promise<AdapterTurnResult>;
  stop(session: AdapterSession, request: AdapterStopRequest): Promise<AdapterStopResult>;
}

export interface AdapterContractFixture {
  expectedProvider: string;
  startRequest: AdapterStartRequest;
  contextEnvelope: AdapterContextEnvelope;
  turnRequest: AdapterTurnRequest;
  stopReason: AdapterStopRequest["reason"];
  expectedResultContent: string;
  expectedEventCount?: number;
  eventTimeoutMs?: number;
}
