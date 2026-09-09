import type { ProviderAdapter, ProviderManagedWriteBridge } from "@lervo/adapter-contract";
import type {
  AdapterCapabilityActivationReceipt,
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterDescriptor,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterStopRequest,
  AdapterTurnRequest,
  AdapterTurnResult,
  ResourceAccountingDescriptor,
} from "@lervo/schemas";
import {
  createAdapterTurnResult,
  createManagedWriteCompletion,
  createManagedWriteRequest,
} from "@lervo/adapter-contract";

const requestDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export class FakeManagedAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly resourceAccounting: ResourceAccountingDescriptor;
  readonly calls: string[] = [];
  readonly turnRequests: AdapterTurnRequest[] = [];
  stopReason: AdapterStopRequest["reason"] | undefined;
  private session: AdapterSession | undefined;
  private turnId: string | undefined;
  private turn: import("@lervo/schemas").AdapterTurn | undefined;
  private envelope: AdapterContextEnvelope | undefined;
  private writeBridge: ProviderManagedWriteBridge | undefined;
  private startRequest: AdapterStartRequest | undefined;
  private releaseTurn!: () => void;
  private readonly turnStarted = new Promise<void>((resolve) => {
    this.releaseTurn = resolve;
  });
  readonly turnAccepted: Promise<void>;
  private acceptTurn!: () => void;

  constructor(
    provider: "codex" | "claude",
    private readonly options: {
      compact?: boolean;
      hang?: boolean;
      mutate?: () => Promise<void>;
      terminalTurnId?: string;
      postTerminalMismatch?: boolean;
      streamFailure?: boolean;
      extraToolEvents?: number;
      failStop?: boolean;
      hangOnStop?: boolean;
      invalidStopCoordinates?: boolean;
      failResult?: boolean;
      failActivation?: boolean;
      failActivationAtStart?: boolean;
      resultContent?: (envelope: AdapterContextEnvelope) => string;
      managedWrite?: {
        path: string;
        targetDigest: string;
        changeKind: "created" | "modified" | "deleted" | "upsert";
        apply(): Promise<void>;
        skipCompletion?: boolean;
        duplicateAuthorization?: boolean;
        duplicateCompletion?: boolean;
      };
    } = {},
  ) {
    this.resourceAccounting = {
      kind: "resource_accounting_descriptor",
      schemaVersion: 2,
      provider,
      adapterId: `lervo/${provider}`,
      adapterVersion: "fixture-1",
      accountingMode: "turn_cumulative",
      observationSupport: "unavailable",
      unavailableReason: "fixture_usage_unavailable",
      normalizationId: "fixture_usage_v1",
      nativeCounterSemanticsId: "fixture_counter_v1",
      requestedModel: null,
      serviceTier: null,
    };
    this.descriptor = {
      kind: "descriptor",
      schemaVersion: 1,
      adapterId: `lervo/${provider}`,
      adapterVersion: "fixture-1",
      provider,
      capabilities: {
        controlledContextInjection: "supported",
        toolCalls: "supported",
        commandExecution: "supported",
        fileChanges: "supported",
        contextCompaction: "supported",
        sessionResume: "unsupported",
        usage: provider === "codex" ? "supported" : "unknown",
      },
    };
    this.turnAccepted = new Promise<void>((resolve) => {
      this.acceptTurn = resolve;
    });
  }

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    this.calls.push("start");
    if (this.options.failActivationAtStart === true) {
      throw Object.assign(new Error("activation failed during provider start"), {
        code: "capability_activation_failed",
      });
    }
    this.startRequest = structuredClone(request);
    this.session = {
      kind: "session",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      roleId: request.roleId,
      writingPolicyId: request.writingPolicyId,
      provider: this.descriptor.provider,
      providerSessionId: `${this.descriptor.provider}-session-1`,
      executionMode: request.executionMode,
      effectiveCapabilities: {
        ...this.descriptor.capabilities,
        fileChanges: request.executionMode === "managed_write" ? "supported" : "unsupported",
      },
      startedAt: request.requestedAt,
    };
    return structuredClone(this.session!);
  }

  inspectProcess(session: AdapterSession) {
    this.calls.push("inspectProcess");
    return {
      kind: "process_observation" as const,
      schemaVersion: 1 as const,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: "running" as const,
      evidence: "owned_process_state" as const,
      observedAt: this.turn === undefined ? session.startedAt : "2026-08-18T01:10:00Z",
    };
  }

  async confirmCapabilityActivation(
    session: AdapterSession,
  ): Promise<AdapterCapabilityActivationReceipt[]> {
    const requests = this.startRequest?.capabilityActivations ?? [];
    if (requests.length === 0) return [];
    this.calls.push("confirmCapabilityActivation");
    if (this.options.failActivation === true) throw new Error("activation failed");
    return requests.map((request) => ({
      kind: "capability_activation_receipt" as const,
      schemaVersion: 1 as const,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      capabilityId: request.capabilityId,
      capabilityKind: request.capabilityKind,
      version: request.version,
      contentHash: request.contentHash,
      evidence:
        request.capabilityKind === "mcp_server"
          ? ("mcp_connected" as const)
          : ("plugin_loaded" as const),
      activationDigest: `sha256:${"d".repeat(64)}`,
      confirmedAt: session.startedAt,
    }));
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    this.calls.push("injectContext");
    this.envelope = structuredClone(envelope);
    return {
      kind: "context_receipt",
      schemaVersion: 1,
      receiptId: `ctx_${this.descriptor.provider}0001`,
      envelopeId: envelope.envelopeId,
      adapterId: this.descriptor.adapterId,
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
    bridge: ProviderManagedWriteBridge,
  ): Promise<void> {
    this.calls.push("attachManagedWriteBridge");
    this.writeBridge = bridge;
  }

  async startTurn(
    _session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: (turn: import("@lervo/schemas").AdapterTurn) => void,
  ) {
    this.calls.push("startTurn");
    this.turnRequests.push(structuredClone(request));
    this.turnId = `${this.descriptor.provider}-turn-1`;
    this.turn = {
      kind: "turn" as const,
      schemaVersion: 1 as const,
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      providerSessionId: request.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId: this.turnId,
      acceptedAt: request.requestedAt,
    };
    accepted(structuredClone(this.turn));
    await this.options.mutate?.();
    this.acceptTurn();
    this.releaseTurn();
    return structuredClone(this.turn);
  }

  async *events(
    _session: AdapterSession,
    signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    const base = () => ({
      kind: "normalized_event" as const,
      schemaVersion: 1 as const,
      projectId: this.session!.projectId,
      runId: this.session!.runId,
      sessionId: this.session!.sessionId,
      providerSessionId: this.session!.providerSessionId,
      occurredAt: "2026-08-18T01:10:00Z",
    });
    yield {
      ...base(),
      eventId: `evt_${this.descriptor.provider}start`,
      type: "provider.session.started",
      payload: { adapterVersion: this.descriptor.adapterVersion },
    };
    await Promise.race([
      this.turnStarted,
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
    if (signal.aborted) return;
    yield {
      ...base(),
      eventId: `evt_${this.descriptor.provider}turn1`,
      type: "provider.turn.started",
      payload: { providerTurnId: this.turnId as string },
    };
    if (
      this.options.managedWrite !== undefined &&
      this.session !== undefined &&
      this.turn !== undefined &&
      this.writeBridge !== undefined
    ) {
      const request = createManagedWriteRequest({
        session: this.session,
        turn: this.turn,
        providerItemId: `${this.descriptor.provider}-write-1`,
        path: this.options.managedWrite.path,
        targetDigest: this.options.managedWrite.targetDigest,
        changeKind: this.options.managedWrite.changeKind,
        requestedAt: "2026-08-18T01:09:00Z",
      });
      const decision = await this.writeBridge.authorize(request);
      if (this.options.managedWrite.duplicateAuthorization === true) {
        await this.writeBridge.authorize(request);
      }
      if (decision.decision === "allow") {
        await this.options.managedWrite.apply();
        if (this.options.managedWrite.skipCompletion !== true) {
          const completion = createManagedWriteCompletion({
            request,
            status: "completed",
            completedAt: "2026-08-18T01:10:00Z",
          });
          await this.writeBridge.complete(completion);
          if (this.options.managedWrite.duplicateCompletion === true) {
            await this.writeBridge.complete(completion);
          }
        }
      }
    }
    if (this.options.compact === true) {
      yield {
        ...base(),
        eventId: `evt_${this.descriptor.provider}comp1`,
        type: "provider.context.compacted",
        payload: {
          providerTurnId: this.turnId as string,
          providerItemId: `${this.descriptor.provider}-compact-1`,
        },
      };
    }
    yield {
      ...base(),
      eventId: `evt_${this.descriptor.provider}tool01`,
      type: "provider.tool.called",
      payload: {
        providerItemId: "tool-1",
        toolName: "Read",
        inputDigest: requestDigest,
        status: "completed",
        durationMs: 2,
      },
    };
    for (let index = 0; index < (this.options.extraToolEvents ?? 0); index += 1) {
      yield {
        ...base(),
        eventId: `evt_${this.descriptor.provider}extra${String(index).padStart(5, "0")}`,
        type: "provider.tool.called",
        payload: {
          providerItemId: `extra-tool-${index}`,
          toolName: "Read",
          inputDigest: requestDigest,
          status: "completed",
          durationMs: 1,
        },
      };
    }
    yield {
      ...base(),
      eventId: `evt_${this.descriptor.provider}cmd001`,
      type: "provider.command.executed",
      payload: {
        providerItemId: "command-1",
        commandDigest: requestDigest,
        cwdRelative: ".",
        status: "completed",
        exitCode: 0,
        outputDigest: requestDigest,
        durationMs: 3,
      },
    };
    if (this.options.hang === true) {
      if (!signal.aborted) {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      return;
    }
    if (this.options.streamFailure === true) throw new Error("fixture stream failure");
    yield {
      ...base(),
      eventId: `evt_${this.descriptor.provider}done01`,
      type: "provider.turn.completed",
      payload: {
        providerTurnId: this.options.terminalTurnId ?? (this.turnId as string),
        status: "completed",
        durationMs: 10,
      },
    };
    if (this.options.postTerminalMismatch === true) {
      yield {
        ...base(),
        eventId: `evt_${this.descriptor.provider}late01`,
        providerSessionId: "foreign-session",
        type: "provider.session.started",
        payload: { adapterVersion: this.descriptor.adapterVersion },
      };
    }
  }

  async getTurnResult(
    session: AdapterSession,
    turn: Awaited<ReturnType<FakeManagedAdapter["startTurn"]>>,
  ): Promise<AdapterTurnResult> {
    this.calls.push("getTurnResult");
    if (this.options.failResult === true) throw new Error("fixture result failure");
    return createAdapterTurnResult({
      session,
      turn,
      content: this.options.resultContent?.(this.envelope!) ?? "fixture provider result",
      producedAt: "2026-08-18T01:10:00Z",
    });
  }

  async stop(_session: AdapterSession, request: AdapterStopRequest) {
    this.calls.push("stop");
    this.stopReason = request.reason;
    if (this.options.failStop === true) throw new Error("fixture stop failure");
    if (this.options.hangOnStop === true) {
      await new Promise<void>(() => undefined);
    }
    return {
      kind: "stop_result" as const,
      schemaVersion: 1 as const,
      adapterId: this.descriptor.adapterId,
      projectId: this.options.invalidStopCoordinates === true ? "prj_foreign" : request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      providerSessionId: request.providerSessionId,
      status: request.reason,
      stoppedAt: request.requestedAt,
    };
  }
}
