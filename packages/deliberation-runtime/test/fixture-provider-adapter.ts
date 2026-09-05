import {
  createAdapterTurnResult,
  type ProviderAdapter,
  type ProviderManagedWriteBridge,
} from "@lervo/adapter-contract";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterDescriptor,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterStopRequest,
  AdapterTurn,
  AdapterTurnRequest,
  AdapterTurnResult,
  ResourceAccountingDescriptor,
} from "@lervo/schemas";

export class FixtureProviderAdapter implements ProviderAdapter {
  readonly resourceAccounting: ResourceAccountingDescriptor = {
    kind: "resource_accounting_descriptor",
    schemaVersion: 1,
    provider: "codex",
    adapterId: "lervo/codex",
    adapterVersion: "fixture-1",
    accountingMode: "turn_cumulative",
    observationSupport: "unavailable",
    unavailableReason: "fixture_usage_unavailable",
    normalizationId: "fixture_usage_v1",
    nativeCounterSemanticsId: "fixture_counter_v1",
    model: null,
    serviceTier: null,
  };
  readonly descriptor: AdapterDescriptor = {
    kind: "descriptor",
    schemaVersion: 1,
    adapterId: "lervo/codex",
    adapterVersion: "fixture-1",
    provider: "codex",
    capabilities: {
      controlledContextInjection: "supported",
      toolCalls: "unsupported",
      commandExecution: "unsupported",
      fileChanges: "unsupported",
      contextCompaction: "unsupported",
      sessionResume: "unsupported",
      usage: "unknown",
    },
  };
  readonly injectedEnvelopes: AdapterContextEnvelope[] = [];
  private turn?: AdapterTurn;
  private releaseTurn?: () => void;
  private readonly turnStarted = new Promise<void>((resolve) => {
    this.releaseTurn = resolve;
  });

  constructor(
    private readonly providerSessionId: string,
    private readonly content: string,
    private readonly extraToolEvents = 0,
  ) {}

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    return {
      kind: "session",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      roleId: request.roleId,
      writingPolicyId: request.writingPolicyId,
      provider: "codex",
      providerSessionId: this.providerSessionId,
      executionMode: request.executionMode,
      effectiveCapabilities: this.descriptor.capabilities,
      startedAt: request.requestedAt,
    };
  }

  inspectProcess(session: AdapterSession) {
    return {
      kind: "process_observation" as const,
      schemaVersion: 1 as const,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: "unobservable" as const,
      evidence: "no_managed_process" as const,
      observedAt: session.startedAt,
    };
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    this.injectedEnvelopes.push(structuredClone(envelope));
    return {
      kind: "context_receipt",
      schemaVersion: 1,
      receiptId: `ctx_adapter_${session.roleId}_0001`,
      envelopeId: envelope.envelopeId,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      roleId: session.roleId,
      writingPolicyId: session.writingPolicyId,
      writingPolicyDocumentId: envelope.writingPolicyDocumentId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      targetTurnId: envelope.targetTurnId,
      contextGeneration: envelope.contextGeneration,
      controlledInput: true,
      documents: envelope.documents.map((document) => ({
        documentId: document.documentId,
        contentHash: document.contentHash,
        scope: document.scope,
        documentRole: document.documentRole,
        referenceEligible: document.referenceEligible,
        status: "injected" as const,
      })),
      acceptedAt: envelope.createdAt,
    };
  }

  async attachManagedWriteBridge(
    _session: AdapterSession,
    _bridge: ProviderManagedWriteBridge,
  ): Promise<void> {}

  async startTurn(
    _session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: (turn: AdapterTurn) => void,
  ): Promise<AdapterTurn> {
    this.turn = {
      kind: "turn",
      schemaVersion: 1,
      adapterId: request.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      providerSessionId: request.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId: `provider-turn-${request.targetTurnId}`,
      acceptedAt: request.requestedAt,
    };
    accepted(structuredClone(this.turn));
    this.releaseTurn?.();
    return structuredClone(this.turn);
  }

  async *events(
    session: AdapterSession,
    signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    await Promise.race([
      this.turnStarted,
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
    if (signal.aborted || this.turn === undefined) return;
    for (let index = 0; index < this.extraToolEvents; index += 1) {
      yield {
        kind: "normalized_event",
        schemaVersion: 1,
        eventId: `evt_provider_${session.roleId}_extra_${String(index).padStart(4, "0")}`,
        projectId: session.projectId,
        runId: session.runId,
        sessionId: session.sessionId,
        providerSessionId: session.providerSessionId,
        type: "provider.tool.called",
        occurredAt: this.turn.acceptedAt,
        payload: {
          providerItemId: `extra-tool-${index}`,
          toolName: "Read",
          inputDigest: `sha256:${"a".repeat(64)}`,
          status: "completed",
          durationMs: 1,
        },
      };
    }
    yield {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: `evt_provider_${session.roleId}_done`,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      type: "provider.turn.completed",
      occurredAt: this.turn.acceptedAt,
      payload: {
        providerTurnId: this.turn.providerTurnId,
        status: "completed",
        durationMs: 1,
      },
    };
  }

  async getTurnResult(session: AdapterSession, turn: AdapterTurn): Promise<AdapterTurnResult> {
    return createAdapterTurnResult({
      session,
      turn,
      content: this.content,
      producedAt: turn.acceptedAt,
    });
  }

  async stop(session: AdapterSession, request: AdapterStopRequest) {
    return {
      kind: "stop_result" as const,
      schemaVersion: 1 as const,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: request.reason,
      stoppedAt: request.requestedAt,
    };
  }
}
