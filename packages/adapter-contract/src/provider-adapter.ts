import {
  type AdapterContextEnvelope,
  type AdapterContextReceipt,
  type AdapterManagedWriteCompletion,
  type AdapterManagedWriteDecision,
  type AdapterManagedWriteRequest,
  type AdapterDescriptor,
  type AdapterNormalizedEvent,
  type AdapterSession,
  type AdapterStartRequest,
  type AdapterStopRequest,
  type AdapterStopResult,
  type AdapterTurn,
  type AdapterTurnResult,
  type AdapterTurnRequest,
} from "@lervo/schemas";

export interface ProviderManagedWriteBridge {
  authorize(request: AdapterManagedWriteRequest): Promise<AdapterManagedWriteDecision>;
  complete(completion: AdapterManagedWriteCompletion): Promise<void>;
}

export type AdapterTurnAccepted = (turn: AdapterTurn) => void;

export interface ProviderAdapter {
  readonly descriptor: AdapterDescriptor;

  start(request: AdapterStartRequest): Promise<AdapterSession>;
  injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt>;
  attachManagedWriteBridge(
    session: AdapterSession,
    bridge: ProviderManagedWriteBridge,
  ): Promise<void>;
  startTurn(
    session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: AdapterTurnAccepted,
  ): Promise<AdapterTurn>;
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
