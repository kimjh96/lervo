import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { codexStoredLoginEnvironment } from "./login-inspection.js";

import {
  createAdapterTurnResult,
  createAdapterProcessObservation,
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
  type AdapterProcessObservation,
  type ResourceAccountingDescriptor,
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
  clone,
  CODEX_ADAPTER_VERSION,
  defaultEventId,
  defaultReceiptId,
  timestamp,
} from "./adapter-validation.js";
import { CodexStdioAppServerClient } from "./app-server-client.js";
import {
  createCodexAdapterDescriptor,
  createCodexResourceAccountingDescriptor,
  requestedCodexModel,
} from "./descriptor.js";
import { buildManagedContextItems } from "./context-items.js";
import { CodexEventNormalizer } from "./normalize.js";
import { CodexSessionRegistry } from "./session-registry.js";
import { CodexManagedWriteController } from "./managed-write.js";
import { CodexResponsesNoToolClient } from "./responses-no-tool-client.js";
import { captureCodexTurnResult } from "./turn-result.js";
import { CodexAdapterError, type CodexAdapterOptions, type CodexAppServerClient } from "./types.js";

export class CodexAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly resourceAccounting: ResourceAccountingDescriptor;

  private readonly repositoryRoot: string;
  private readonly now: () => Date;
  private readonly createEventId: () => string;
  private readonly createReceiptId: () => string;
  private readonly sessions = new CodexSessionRegistry();

  private readonly processEnvironment: Record<string, string> | undefined;
  constructor(private readonly options: CodexAdapterOptions) {
    if (options.loginContext !== undefined && options.transport?.kind === "responses_api_no_tools")
      throw new TypeError("Stored login context requires the native app-server transport.");
    this.processEnvironment =
      options.loginContext === undefined
        ? undefined
        : codexStoredLoginEnvironment(structuredClone(options.loginContext));
    this.descriptor = createCodexAdapterDescriptor();
    this.resourceAccounting = createCodexResourceAccountingDescriptor(options);
    this.repositoryRoot = resolve(options.repositoryRoot);
    this.now = options.now ?? (() => new Date());
    this.createEventId = options.createEventId ?? defaultEventId;
    this.createReceiptId = options.createReceiptId ?? defaultReceiptId;
    assertAdapterMessage(this.descriptor, "Codex adapter descriptor");
  }

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    assertAdapterMessage(request, "Codex start request");
    if (request.adapterId !== this.descriptor.adapterId) {
      throw new CodexAdapterError(
        "session_mismatch",
        "The start request adapter ID does not identify Codex.",
      );
    }
    const sandbox = this.options.sandbox ?? "read-only";
    const approvalPolicy =
      this.options.approvalPolicy ??
      (request.executionMode === "managed_write" ? "on-request" : "never");
    if (
      sandbox !== "read-only" ||
      (request.executionMode === "read_only"
        ? approvalPolicy !== "never"
        : approvalPolicy !== "on-request")
    ) {
      throw new CodexAdapterError(
        "invalid_request",
        "The Codex managed session execution mode is inconsistent with its sandbox and approval settings.",
      );
    }
    const requestedNoToolTransport = this.options.transport?.kind === "responses_api_no_tools";
    if (
      requestedNoToolTransport &&
      (request.executionMode !== "read_only" || request.capabilityActivations?.length)
    ) {
      throw new CodexAdapterError(
        "invalid_request",
        "The Codex Responses no-tool transport accepts only a read-only session without capability activations.",
      );
    }
    const client = await this.createClient();
    const noToolTransport = client.toolBoundary === "no_tools";
    if (requestedNoToolTransport !== noToolTransport) {
      await client.close().catch(() => undefined);
      throw new CodexAdapterError(
        "capability_activation_failed",
        "The selected Codex client did not attest the requested tool boundary.",
      );
    }
    try {
      const activations = request.capabilityActivations ?? [];
      const mcpServers: Record<string, unknown> = {};
      const selectedCapabilityRoots: NonNullable<
        import("./types.js").CodexThreadStartOptions["selectedCapabilityRoots"]
      > = [];
      for (const activation of activations) {
        const runtime = activation.runtime;
        if (runtime.kind === "provider_plugin") {
          if (runtime.provider !== "codex") {
            throw new CodexAdapterError(
              "invalid_request",
              "A provider plugin targets a different provider.",
            );
          }
          selectedCapabilityRoots.push({
            id: `${activation.capabilityId}@${activation.version}`,
            location: {
              type: "environment",
              environmentId: "lervo-local",
              path: runtime.pluginRoot,
            },
          });
        } else if (runtime.kind === "mcp_stdio") {
          mcpServers[runtime.serverName] = {
            command: runtime.command,
            args: [...runtime.arguments],
            env: this.credentials(runtime.credentialNames),
            startup_timeout_sec: runtime.timeoutMs / 1000,
          };
        } else {
          mcpServers[runtime.serverName] = {
            url: runtime.url,
            ...(runtime.bearerTokenCredential === null
              ? {}
              : { bearer_token_env_var: runtime.bearerTokenCredential }),
            startup_timeout_sec: runtime.timeoutMs / 1000,
          };
          if (
            runtime.bearerTokenCredential !== null &&
            process.env[runtime.bearerTokenCredential] === undefined
          ) {
            throw new CodexAdapterError(
              "capability_activation_failed",
              "A required MCP credential is unavailable.",
            );
          }
        }
      }
      const thread = await client.startThread({
        cwd: this.repositoryRoot,
        approvalPolicy,
        sandbox,
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
        ...(this.options.baseInstructions === undefined
          ? {}
          : { baseInstructions: this.options.baseInstructions }),
        config: {
          features: { hooks: false },
          ...(Object.keys(mcpServers).length === 0 ? {} : { mcp_servers: mcpServers }),
        },
        ...(selectedCapabilityRoots.length === 0 ? {} : { selectedCapabilityRoots }),
      });
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
        providerSessionId: thread.threadId,
        executionMode: request.executionMode,
        effectiveCapabilities: {
          ...this.descriptor.capabilities,
          ...(noToolTransport
            ? {
                toolCalls: "unsupported" as const,
                commandExecution: "unsupported" as const,
                fileChanges: "unsupported" as const,
                contextCompaction: "unsupported" as const,
              }
            : {
                fileChanges:
                  request.executionMode === "managed_write"
                    ? ("supported" as const)
                    : ("unsupported" as const),
              }),
        },
        startedAt: timestamp(this.now, "Codex session start time", request.requestedAt),
      };
      assertAdapterMessage(session, "Codex session");
      this.sessions.add(
        session,
        client,
        activations,
        requestedCodexModel(this.options),
        thread.model ?? null,
      );
      return clone(session);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  inspectProcess(session: AdapterSession): AdapterProcessObservation {
    const state = this.sessions.get(session);
    return createAdapterProcessObservation({
      session: state.session,
      state: state.client.inspectProcess?.() ?? {
        status: "unobservable",
        evidence: "transport_state_unavailable",
      },
      observedAt: timestamp(this.now, "Codex process observation time", session.startedAt),
    });
  }

  async confirmCapabilityActivation(
    session: AdapterSession,
  ): Promise<AdapterCapabilityActivationReceipt[]> {
    const state = this.sessions.get(session);
    if (state.activationConfirmed) {
      throw new CodexAdapterError(
        "invalid_request",
        "Capability activation can be confirmed only once.",
      );
    }
    const mcpNames = state.capabilityActivations.flatMap((activation) =>
      activation.runtime.kind === "mcp_stdio" || activation.runtime.kind === "mcp_http"
        ? [activation.runtime.serverName]
        : [],
    );
    if (mcpNames.length > 0 && state.client.listConnectedMcpServers === undefined) {
      throw new CodexAdapterError(
        "capability_activation_failed",
        "The Codex client cannot confirm MCP connection state.",
      );
    }
    const connected = new Set(
      mcpNames.length === 0
        ? []
        : await state.client.listConnectedMcpServers!(session.providerSessionId),
    );
    if (mcpNames.some((name) => !connected.has(name))) {
      throw new CodexAdapterError(
        "capability_activation_failed",
        "Codex did not report every requested MCP server as connected.",
      );
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
    assertAdapterMessage(envelope, "Codex context envelope");
    if (state.injectedTargetTurnIds.has(envelope.targetTurnId)) {
      throw new CodexAdapterError(
        "invalid_request",
        "Context cannot be injected twice into the same target turn.",
      );
    }
    const items = await buildManagedContextItems(
      clone(state.session),
      clone(envelope),
      this.options.resolveArtifact,
    );
    await state.client.injectItems(session.providerSessionId, items);
    const acceptedAt = timestamp(this.now, "Codex context receipt time", envelope.createdAt);
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
      acceptedAt,
    };
    assertAdapterMessage(receipt, "Codex context receipt");
    state.injectedTargetTurnIds.add(envelope.targetTurnId);
    return clone(receipt);
  }

  async attachManagedWriteBridge(
    session: AdapterSession,
    bridge: ProviderManagedWriteBridge,
  ): Promise<void> {
    const state = this.sessions.get(session);
    if (state.managedWrites !== undefined) {
      throw new CodexAdapterError("invalid_request", "A managed write bridge is already attached.");
    }
    state.managedWrites = new CodexManagedWriteController({
      session: state.session,
      repositoryRoot: this.repositoryRoot,
      bridge,
      client: state.client,
      now: this.now,
    });
  }

  async startTurn(
    session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: AdapterTurnAccepted,
  ): Promise<AdapterTurn> {
    const state = this.sessions.get(session);
    assertAdapterMessage(request, "Codex turn request");
    if (
      request.adapterId !== this.descriptor.adapterId ||
      request.projectId !== session.projectId ||
      request.runId !== session.runId ||
      request.sessionId !== session.sessionId ||
      request.providerSessionId !== session.providerSessionId
    ) {
      throw new CodexAdapterError(
        "session_mismatch",
        "The turn request does not match the managed Codex session.",
      );
    }
    if (!state.injectedTargetTurnIds.has(request.targetTurnId)) {
      throw new CodexAdapterError(
        "invalid_request",
        "The current target turn has no controlled context receipt.",
      );
    }
    if (
      state.startedTargetTurnIds.has(request.targetTurnId) ||
      state.activeProviderTurnId !== undefined
    ) {
      throw new CodexAdapterError(
        "invalid_request",
        "The Codex turn has already started or is still active.",
      );
    }
    const providerTurn = await state.client.startTurn(
      session.providerSessionId,
      request.instructions,
      {
        ...(this.options.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: this.options.reasoningEffort }),
        ...(this.options.structuredOutputSchema === undefined
          ? {}
          : { outputSchema: structuredClone(this.options.structuredOutputSchema) }),
      },
    );
    state.activeProviderTurnId = providerTurn.turnId;
    state.startedTargetTurnIds.add(request.targetTurnId);
    const turn: AdapterTurn = {
      kind: "turn",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId: providerTurn.turnId,
      acceptedAt: timestamp(this.now, "Codex turn acceptance time", request.requestedAt),
    };
    assertAdapterMessage(turn, "Codex turn");
    state.activeTurn = clone(turn);
    accepted(clone(turn));
    return clone(turn);
  }

  async *events(
    session: AdapterSession,
    signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    const state = this.sessions.get(session);
    if (state.eventStreamClaimed) {
      throw new CodexAdapterError(
        "invalid_request",
        "The Codex event stream can be opened only once per session.",
      );
    }
    state.eventStreamClaimed = true;
    const normalizer = new CodexEventNormalizer({
      session: clone(state.session),
      repositoryRoot: this.repositoryRoot,
      adapterVersion: CODEX_ADAPTER_VERSION,
      now: this.now,
      createEventId: this.createEventId,
      observedModel: () => state.sessionObservedModel,
    });
    try {
      for await (const notification of state.client.notifications(signal)) {
        if (await state.managedWrites?.handle(notification, state.activeTurn)) continue;
        const normalized = normalizer.normalize(notification);
        const captured = captureCodexTurnResult({
          raw: notification,
          providerSessionId: session.providerSessionId,
          now: this.now,
          requestedModel: state.requestedModel,
          sessionObservedModel: state.sessionObservedModel,
        });
        if (captured !== null) {
          state.turnResults.set(captured.providerTurnId, captured);
        }
        if (normalized === null) continue;
        assertAdapterMessage(normalized, "Codex normalized event");
        if (
          normalized.type === "provider.turn.completed" ||
          normalized.type === "provider.turn.failed"
        ) {
          delete state.activeProviderTurnId;
          delete state.activeTurn;
        }
        yield clone(normalized);
      }
    } catch (error) {
      if (signal.aborted) return;
      if (!(error instanceof CodexAdapterError)) throw error;
      const normalized = normalizer.normalize({
        method: "error",
        params: {
          threadId: session.providerSessionId,
          error: {
            code: error instanceof CodexAdapterError ? error.code : "provider_process_failed",
          },
          willRetry: false,
        },
      });
      if (normalized !== null) yield normalized;
    }
  }

  async getTurnResult(session: AdapterSession, turn: AdapterTurn): Promise<AdapterTurnResult> {
    const state = this.sessions.get(session);
    assertAdapterMessage(turn, "Codex turn");
    if (
      turn.adapterId !== session.adapterId ||
      turn.projectId !== session.projectId ||
      turn.runId !== session.runId ||
      turn.sessionId !== session.sessionId ||
      turn.providerSessionId !== session.providerSessionId
    ) {
      throw new CodexAdapterError(
        "session_mismatch",
        "The turn result request does not match the Codex session.",
      );
    }
    const captured = state.turnResults.get(turn.providerTurnId);
    if (captured === undefined) {
      throw new CodexAdapterError(
        "provider_protocol_failed",
        "The completed Codex turn has no final result.",
      );
    }
    const result = createAdapterTurnResult({ session, turn, ...captured });
    assertAdapterMessage(result, "Codex turn result");
    return clone(result);
  }

  async stop(session: AdapterSession, request: AdapterStopRequest): Promise<AdapterStopResult> {
    const state = this.sessions.get(session);
    assertAdapterMessage(request, "Codex stop request");
    if (
      request.adapterId !== this.descriptor.adapterId ||
      request.projectId !== session.projectId ||
      request.runId !== session.runId ||
      request.sessionId !== session.sessionId ||
      request.providerSessionId !== session.providerSessionId
    ) {
      throw new CodexAdapterError(
        "session_mismatch",
        "The stop request does not match the managed Codex session.",
      );
    }
    let stopFailure: CodexAdapterError | undefined;
    try {
      if (request.reason === "cancelled" && state.activeProviderTurnId !== undefined) {
        await state.client.interruptTurn(session.providerSessionId, state.activeProviderTurnId);
      }
      await state.client.unsubscribe(session.providerSessionId);
      await state.client.close();
    } catch {
      await state.client.close().catch(() => undefined);
      stopFailure = new CodexAdapterError(
        "provider_process_failed",
        "The Codex session could not be stopped safely.",
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
      stoppedAt: timestamp(this.now, "Codex session stop time", request.requestedAt),
    };
    assertAdapterMessage(result, "Codex stop result");
    return clone(result);
  }

  private async createClient(): Promise<CodexAppServerClient> {
    if (this.options.clientFactory !== undefined) return this.options.clientFactory();
    if (this.options.transport?.kind === "responses_api_no_tools") {
      return new CodexResponsesNoToolClient({
        ...(this.options.transport.apiKey === undefined
          ? {}
          : { apiKey: this.options.transport.apiKey }),
        ...(this.options.transport.model === undefined
          ? {}
          : { model: this.options.transport.model }),
        ...(this.options.transport.fetch === undefined
          ? {}
          : { fetch: this.options.transport.fetch }),
        requestTimeoutMs: this.options.requestTimeoutMs ?? 30_000,
        now: this.now,
      });
    }
    return CodexStdioAppServerClient.connect({
      ...(this.processEnvironment === undefined
        ? {}
        : { environment: { ...this.processEnvironment } }),
      executable: this.options.executable ?? "codex",
      cwd: this.repositoryRoot,
      requestTimeoutMs: this.options.requestTimeoutMs ?? 30_000,
    });
  }

  private credentials(names: readonly string[]): Record<string, string> {
    const values: Record<string, string> = {};
    for (const name of names) {
      const value = process.env[name];
      if (value === undefined) {
        throw new CodexAdapterError(
          "capability_activation_failed",
          "A required MCP credential is unavailable.",
        );
      }
      values[name] = value;
    }
    return values;
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
        "Codex capability activation confirmation time",
        session.startedAt,
      ),
    };
    assertAdapterMessage(receipt, "Codex capability activation receipt");
    return receipt;
  }
}
