import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  createAdapterTurnResult,
  type AdapterTurnAccepted,
  type ProviderAdapter,
  type ProviderManagedWriteBridge,
} from "@lervo/adapter-contract";
import {
  type AdapterContextEnvelope,
  type AdapterContextReceipt,
  type AdapterCapabilityActivationReceipt,
  type AdapterCapabilityActivationRequest,
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

import {
  assertAdapterMessage,
  CLAUDE_ADAPTER_ID,
  CLAUDE_ADAPTER_VERSION,
  clone,
  defaultEventId,
  defaultReceiptId,
  timestamp,
} from "./adapter-validation.js";
import { buildManagedContextMessage } from "./context-message.js";
import { ClaudeEventNormalizer } from "./normalize.js";
import { ClaudeManagedWriteController } from "./managed-write.js";
import { ClaudeSdkAgentClient } from "./sdk-client.js";
import { ClaudeSessionRegistry } from "./session-registry.js";
import { captureClaudeTurnResult } from "./turn-result.js";
import { buildClaudeManagedTurnMessage } from "./turn-message.js";
import {
  ClaudeAdapterError,
  type ClaudeAdapterOptions,
  type ClaudePermissionMode,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);
const MANAGED_WRITE_TOOLS = new Set(["Read", "Glob", "Grep", "Write", "Edit"]);

export class ClaudeAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor = {
    kind: "descriptor",
    schemaVersion: 1,
    adapterId: CLAUDE_ADAPTER_ID,
    adapterVersion: CLAUDE_ADAPTER_VERSION,
    provider: "claude",
    capabilities: {
      controlledContextInjection: "supported",
      toolCalls: "supported",
      commandExecution: "supported",
      fileChanges: "supported",
      contextCompaction: "supported",
      sessionResume: "unsupported",
      usage: "supported",
    },
  };

  private readonly repositoryRoot: string;
  private readonly now: () => Date;
  private readonly createEventId: () => string;
  private readonly createReceiptId: () => string;
  private readonly createProviderSessionId: () => string;
  private readonly createProviderMessageId: () => string;
  private readonly sessions = new ClaudeSessionRegistry();

  constructor(private readonly options: ClaudeAdapterOptions) {
    this.repositoryRoot = resolve(options.repositoryRoot);
    this.now = options.now ?? (() => new Date());
    this.createEventId = options.createEventId ?? defaultEventId;
    this.createReceiptId = options.createReceiptId ?? defaultReceiptId;
    this.createProviderSessionId = options.createProviderSessionId ?? randomUUID;
    this.createProviderMessageId = options.createProviderMessageId ?? randomUUID;
    assertAdapterMessage(this.descriptor, "Claude adapter descriptor");
  }

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    assertAdapterMessage(request, "Claude start request");
    if (request.adapterId !== this.descriptor.adapterId) {
      throw new ClaudeAdapterError(
        "session_mismatch",
        "The start request adapter ID does not identify Claude.",
      );
    }
    const permissionMode =
      this.options.permissionMode ??
      (request.executionMode === "managed_write" ? "default" : "plan");
    const tools = [
      ...(this.options.tools ??
        (request.executionMode === "managed_write" ? MANAGED_WRITE_TOOLS : READ_ONLY_TOOLS)),
    ];
    const allowedTools =
      request.executionMode === "managed_write" ? MANAGED_WRITE_TOOLS : READ_ONLY_TOOLS;
    if (
      (request.executionMode === "managed_write"
        ? permissionMode !== "default"
        : permissionMode !== "plan") ||
      tools.some((tool) => !allowedTools.has(tool))
    ) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "The Claude managed session execution mode is inconsistent with its permission and tool settings.",
      );
    }
    const providerSessionId = this.uuid(
      this.createProviderSessionId(),
      "Claude provider session ID",
    );
    const activations = request.capabilityActivations ?? [];
    const client = await this.createClient(providerSessionId, permissionMode, tools, activations);
    try {
      const session: AdapterSession = {
        kind: "session",
        schemaVersion: 1,
        adapterId: this.descriptor.adapterId,
        projectId: request.projectId,
        runId: request.runId,
        sessionId: request.sessionId,
        roleId: request.roleId,
        writingPolicyId: request.writingPolicyId,
        provider: this.descriptor.provider,
        providerSessionId,
        executionMode: request.executionMode,
        effectiveCapabilities: {
          ...this.descriptor.capabilities,
          toolCalls: tools.length === 0 ? "unsupported" : "supported",
          commandExecution: "unsupported",
          fileChanges: request.executionMode === "managed_write" ? "supported" : "unsupported",
        },
        startedAt: timestamp(this.now, "Claude session start time", request.requestedAt),
      };
      assertAdapterMessage(session, "Claude session");
      this.sessions.add(session, client, activations);
      return clone(session);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async confirmCapabilityActivation(
    session: AdapterSession,
  ): Promise<AdapterCapabilityActivationReceipt[]> {
    const state = this.sessions.get(session);
    if (state.activationConfirmed) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "Capability activation can be confirmed only once.",
      );
    }
    if (state.capabilityActivations.length > 0) {
      if (state.client.confirmCapabilities === undefined) {
        throw new ClaudeAdapterError(
          "capability_activation_failed",
          "The Claude client cannot confirm capability state.",
        );
      }
      await state.client.confirmCapabilities();
    }
    state.activationConfirmed = true;
    return state.capabilityActivations.map((activation) =>
      this.activationReceipt(session, activation),
    );
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    const state = this.sessions.get(session);
    assertAdapterMessage(envelope, "Claude context envelope");
    if (state.injectedTargetTurnIds.has(envelope.targetTurnId)) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "Context cannot be injected twice into the same target turn.",
      );
    }
    const content = await buildManagedContextMessage(
      clone(state.session),
      clone(envelope),
      this.options.resolveArtifact,
    );
    await state.client.appendContext(content);
    const receipt: AdapterContextReceipt = {
      kind: "context_receipt",
      schemaVersion: 1,
      receiptId: this.createReceiptId(),
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
        scope: clone(document.scope),
        documentRole: document.documentRole,
        referenceEligible: document.referenceEligible,
        status: "injected" as const,
      })),
      acceptedAt: timestamp(this.now, "Claude context receipt time", envelope.createdAt),
    };
    assertAdapterMessage(receipt, "Claude context receipt");
    state.injectedTargetTurnIds.add(envelope.targetTurnId);
    return clone(receipt);
  }

  async attachManagedWriteBridge(
    session: AdapterSession,
    bridge: ProviderManagedWriteBridge,
  ): Promise<void> {
    const state = this.sessions.get(session);
    if (state.managedWrites !== undefined) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "A managed write bridge is already attached.",
      );
    }
    state.managedWrites = new ClaudeManagedWriteController({
      session: state.session,
      activeTurn: () => state.activeTurn,
      repositoryRoot: this.repositoryRoot,
      bridge,
      now: this.now,
    });
    state.client.attachToolUseHandler(state.managedWrites);
  }

  async startTurn(
    session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: AdapterTurnAccepted,
  ): Promise<AdapterTurn> {
    const state = this.sessions.get(session);
    assertAdapterMessage(request, "Claude turn request");
    if (
      request.adapterId !== this.descriptor.adapterId ||
      request.projectId !== session.projectId ||
      request.runId !== session.runId ||
      request.sessionId !== session.sessionId ||
      request.providerSessionId !== session.providerSessionId
    ) {
      throw new ClaudeAdapterError(
        "session_mismatch",
        "The turn request does not match the managed Claude session.",
      );
    }
    if (!state.injectedTargetTurnIds.has(request.targetTurnId)) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "The current target turn has no controlled context receipt.",
      );
    }
    if (
      state.startedTargetTurnIds.has(request.targetTurnId) ||
      state.activeProviderTurnId !== undefined
    ) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "The Claude turn has already started or is still active.",
      );
    }
    const providerTurnId = this.uuid(this.createProviderMessageId(), "Claude provider turn ID");
    state.activeProviderTurnId = providerTurnId;
    const turn: AdapterTurn = {
      kind: "turn",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId,
      acceptedAt: timestamp(this.now, "Claude turn acceptance time", request.requestedAt),
    };
    assertAdapterMessage(turn, "Claude turn");
    state.activeTurn = clone(turn);
    accepted(clone(turn));
    try {
      await state.client.startTurn(
        providerTurnId,
        buildClaudeManagedTurnMessage(this.repositoryRoot, request.instructions),
      );
    } catch (error) {
      delete state.activeProviderTurnId;
      delete state.activeTurn;
      throw error;
    }
    state.startedTargetTurnIds.add(request.targetTurnId);
    return clone(turn);
  }

  async *events(
    session: AdapterSession,
    signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    const state = this.sessions.get(session);
    if (state.eventStreamClaimed) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "The Claude event stream can be opened only once per session.",
      );
    }
    state.eventStreamClaimed = true;
    const normalizer = new ClaudeEventNormalizer({
      session: clone(state.session),
      repositoryRoot: this.repositoryRoot,
      adapterVersion: CLAUDE_ADAPTER_VERSION,
      now: this.now,
      createEventId: this.createEventId,
      activeProviderTurnId: () => state.activeProviderTurnId,
      structuredOutputCarrierEnabled: this.options.structuredOutputSchema !== undefined,
    });
    try {
      for await (const raw of state.client.messages(signal)) {
        const activeProviderTurnId = state.activeProviderTurnId;
        const normalizedEvents = normalizer.normalize(raw);
        if (normalizedEvents.some((event) => event.type === "provider.turn.completed")) {
          const captured = captureClaudeTurnResult({
            raw,
            providerSessionId: session.providerSessionId,
            activeProviderTurnId,
            captureStructuredOutput: this.options.structuredOutputSchema !== undefined,
            now: this.now,
          });
          if (captured !== null) {
            state.turnResults.set(captured.providerTurnId, {
              content: captured.content,
              producedAt: captured.producedAt,
            });
          }
        }
        for (const normalized of normalizedEvents) {
          assertAdapterMessage(normalized, "Claude normalized event");
          if (
            normalized.type === "provider.turn.completed" ||
            normalized.type === "provider.turn.failed"
          ) {
            delete state.activeProviderTurnId;
            delete state.activeTurn;
          }
          yield clone(normalized);
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (!(error instanceof ClaudeAdapterError)) throw error;
      const code = error.code;
      const normalized = normalizer.failure(code, { code });
      assertAdapterMessage(normalized, "Claude failure event");
      yield normalized;
    }
  }

  async getTurnResult(session: AdapterSession, turn: AdapterTurn): Promise<AdapterTurnResult> {
    const state = this.sessions.get(session);
    assertAdapterMessage(turn, "Claude turn");
    if (
      turn.adapterId !== session.adapterId ||
      turn.projectId !== session.projectId ||
      turn.runId !== session.runId ||
      turn.sessionId !== session.sessionId ||
      turn.providerSessionId !== session.providerSessionId
    ) {
      throw new ClaudeAdapterError(
        "session_mismatch",
        "The turn result request does not match the Claude session.",
      );
    }
    const captured = state.turnResults.get(turn.providerTurnId);
    if (captured === undefined) {
      throw new ClaudeAdapterError(
        "provider_protocol_failed",
        "The completed Claude turn has no final result.",
      );
    }
    const result = createAdapterTurnResult({ session, turn, ...captured });
    assertAdapterMessage(result, "Claude turn result");
    return clone(result);
  }

  async stop(session: AdapterSession, request: AdapterStopRequest): Promise<AdapterStopResult> {
    const state = this.sessions.get(session);
    assertAdapterMessage(request, "Claude stop request");
    if (
      request.adapterId !== this.descriptor.adapterId ||
      request.projectId !== session.projectId ||
      request.runId !== session.runId ||
      request.sessionId !== session.sessionId ||
      request.providerSessionId !== session.providerSessionId
    ) {
      throw new ClaudeAdapterError(
        "session_mismatch",
        "The stop request does not match the managed Claude session.",
      );
    }
    let stopFailure: ClaudeAdapterError | undefined;
    try {
      if (request.reason === "cancelled" && state.activeProviderTurnId !== undefined) {
        await state.client.interrupt();
      }
      await state.client.close();
    } catch {
      await state.client.close().catch(() => undefined);
      stopFailure = new ClaudeAdapterError(
        "provider_process_failed",
        "The Claude session could not be stopped safely.",
      );
    } finally {
      this.sessions.release(session);
    }
    if (stopFailure !== undefined) throw stopFailure;
    const result: AdapterStopResult = {
      kind: "stop_result",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: request.reason,
      stoppedAt: timestamp(this.now, "Claude session stop time", request.requestedAt),
    };
    assertAdapterMessage(result, "Claude stop result");
    return clone(result);
  }

  private async createClient(
    providerSessionId: string,
    permissionMode: ClaudePermissionMode,
    tools: readonly string[],
    capabilityActivations: readonly AdapterCapabilityActivationRequest[],
  ) {
    const clientOptions = {
      providerSessionId,
      cwd: this.repositoryRoot,
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
      ...(this.options.systemPrompt === undefined
        ? {}
        : { systemPrompt: this.options.systemPrompt }),
      ...(this.options.executable === undefined ? {} : { executable: this.options.executable }),
      ...(this.options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: this.options.reasoningEffort }),
      permissionMode,
      requestTimeoutMs: this.options.requestTimeoutMs ?? 30_000,
      createMessageId: this.createProviderMessageId,
      tools: [...tools],
      ...(this.options.structuredOutputSchema === undefined
        ? {}
        : {
            outputFormat: {
              type: "json_schema" as const,
              schema: structuredClone(this.options.structuredOutputSchema),
            },
          }),
      capabilityActivations: structuredClone(capabilityActivations),
    };
    if (this.options.clientFactory !== undefined) return this.options.clientFactory(clientOptions);
    return ClaudeSdkAgentClient.connect(clientOptions, this.options.sdkStartup);
  }

  private activationReceipt(
    session: AdapterSession,
    activation: AdapterCapabilityActivationRequest,
  ): AdapterCapabilityActivationReceipt {
    const evidence = activation.capabilityKind === "mcp_server" ? "mcp_connected" : "plugin_loaded";
    const receipt: AdapterCapabilityActivationReceipt = {
      kind: "capability_activation_receipt",
      schemaVersion: 1,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      capabilityId: activation.capabilityId,
      capabilityKind: activation.capabilityKind,
      version: activation.version,
      contentHash: activation.contentHash,
      evidence,
      activationDigest: `sha256:${createHash("sha256")
        .update(
          JSON.stringify({
            capabilityId: activation.capabilityId,
            version: activation.version,
            contentHash: activation.contentHash,
            adapterId: session.adapterId,
            providerSessionId: session.providerSessionId,
            evidence,
          }),
        )
        .digest("hex")}`,
      confirmedAt: timestamp(
        this.now,
        "Claude capability activation confirmation time",
        session.startedAt,
      ),
    };
    assertAdapterMessage(receipt, "Claude capability activation receipt");
    return receipt;
  }

  private uuid(value: string, label: string): string {
    if (!UUID_PATTERN.test(value)) {
      throw new ClaudeAdapterError("invalid_request", `${label} must be a UUID.`);
    }
    return value;
  }
}
