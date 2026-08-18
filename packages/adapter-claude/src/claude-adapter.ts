import { randomUUID } from "node:crypto";
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
import {
  ClaudeManagedWriteController,
} from "./managed-write.js";
import { ClaudeSdkAgentClient } from "./sdk-client.js";
import { ClaudeSessionRegistry } from "./session-registry.js";
import { captureClaudeTurnResult } from "./turn-result.js";
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
      usage: "unknown",
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
      throw new ClaudeAdapterError("session_mismatch", "Start request의 adapter ID가 Claude와 다릅니다.");
    }
    const permissionMode =
      this.options.permissionMode ??
      (request.executionMode === "managed_write" ? "default" : "plan");
    const tools = [
      ...(this.options.tools ??
        (request.executionMode === "managed_write"
          ? MANAGED_WRITE_TOOLS
          : READ_ONLY_TOOLS)),
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
        "Claude managed session의 실행 모드와 permission·tool 설정이 다릅니다.",
      );
    }
    const providerSessionId = this.uuid(this.createProviderSessionId(), "Claude provider session ID");
    const client = await this.createClient(providerSessionId, permissionMode, tools);
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
          commandExecution: "unsupported",
          fileChanges:
            request.executionMode === "managed_write" ? "supported" : "unsupported",
        },
        startedAt: timestamp(this.now, "Claude session 시작 시각", request.requestedAt),
      };
      assertAdapterMessage(session, "Claude session");
      this.sessions.add(session, client);
      return clone(session);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    const state = this.sessions.get(session);
    assertAdapterMessage(envelope, "Claude context envelope");
    if (state.injectedTargetTurnIds.has(envelope.targetTurnId)) {
      throw new ClaudeAdapterError("invalid_request", "같은 target turn에 context를 두 번 주입할 수 없습니다.");
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
        status: "injected" as const,
      })),
      acceptedAt: timestamp(this.now, "Claude context receipt 시각", envelope.createdAt),
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
      throw new ClaudeAdapterError("invalid_request", "Managed write bridge가 이미 연결되었습니다.");
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
      throw new ClaudeAdapterError("session_mismatch", "Turn request가 managed Claude session과 다릅니다.");
    }
    if (!state.injectedTargetTurnIds.has(request.targetTurnId)) {
      throw new ClaudeAdapterError("invalid_request", "현재 target turn에 controlled context receipt가 없습니다.");
    }
    if (state.startedTargetTurnIds.has(request.targetTurnId) || state.activeProviderTurnId !== undefined) {
      throw new ClaudeAdapterError("invalid_request", "Claude turn이 이미 시작되었거나 실행 중입니다.");
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
      acceptedAt: timestamp(this.now, "Claude turn 수락 시각", request.requestedAt),
    };
    assertAdapterMessage(turn, "Claude turn");
    state.activeTurn = clone(turn);
    accepted(clone(turn));
    try {
      await state.client.startTurn(providerTurnId, request.instructions);
    } catch (error) {
      delete state.activeProviderTurnId;
      delete state.activeTurn;
      throw error;
    }
    state.startedTargetTurnIds.add(request.targetTurnId);
    return clone(turn);
  }

  async *events(session: AdapterSession, signal: AbortSignal): AsyncIterable<AdapterNormalizedEvent> {
    const state = this.sessions.get(session);
    if (state.eventStreamClaimed) {
      throw new ClaudeAdapterError("invalid_request", "Claude event stream은 session마다 한 번만 열 수 있습니다.");
    }
    state.eventStreamClaimed = true;
    const normalizer = new ClaudeEventNormalizer({
      session: clone(state.session),
      repositoryRoot: this.repositoryRoot,
      adapterVersion: CLAUDE_ADAPTER_VERSION,
      now: this.now,
      createEventId: this.createEventId,
      activeProviderTurnId: () => state.activeProviderTurnId,
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

  async getTurnResult(
    session: AdapterSession,
    turn: AdapterTurn,
  ): Promise<AdapterTurnResult> {
    const state = this.sessions.get(session);
    assertAdapterMessage(turn, "Claude turn");
    if (
      turn.adapterId !== session.adapterId ||
      turn.projectId !== session.projectId ||
      turn.runId !== session.runId ||
      turn.sessionId !== session.sessionId ||
      turn.providerSessionId !== session.providerSessionId
    ) {
      throw new ClaudeAdapterError("session_mismatch", "Turn result 요청이 Claude session과 다릅니다.");
    }
    const captured = state.turnResults.get(turn.providerTurnId);
    if (captured === undefined) {
      throw new ClaudeAdapterError(
        "provider_protocol_failed",
        "완료된 Claude turn의 최종 결과가 없습니다.",
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
      throw new ClaudeAdapterError("session_mismatch", "Stop request가 managed Claude session과 다릅니다.");
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
        "Claude session을 안전하게 종료하지 못했습니다.",
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
      stoppedAt: timestamp(this.now, "Claude session 종료 시각", request.requestedAt),
    };
    assertAdapterMessage(result, "Claude stop result");
    return clone(result);
  }

  private async createClient(
    providerSessionId: string,
    permissionMode: ClaudePermissionMode,
    tools: readonly string[],
  ) {
    const clientOptions = {
      providerSessionId,
      cwd: this.repositoryRoot,
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
      ...(this.options.executable === undefined ? {} : { executable: this.options.executable }),
      permissionMode,
      requestTimeoutMs: this.options.requestTimeoutMs ?? 30_000,
      createMessageId: this.createProviderMessageId,
      tools: [...tools],
    };
    if (this.options.clientFactory !== undefined) return this.options.clientFactory(clientOptions);
    return ClaudeSdkAgentClient.connect(clientOptions, this.options.sdkStartup);
  }

  private uuid(value: string, label: string): string {
    if (!UUID_PATTERN.test(value)) {
      throw new ClaudeAdapterError("invalid_request", `${label}는 UUID여야 합니다.`);
    }
    return value;
  }
}
