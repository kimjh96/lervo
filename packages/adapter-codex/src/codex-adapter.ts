import { resolve } from "node:path";

import type { ProviderAdapter } from "@roven/adapter-contract";
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
  type AdapterTurnRequest,
} from "@roven/schemas";

import {
  assertAdapterMessage,
  clone,
  CODEX_ADAPTER_ID,
  CODEX_ADAPTER_VERSION,
  defaultEventId,
  defaultReceiptId,
  timestamp,
} from "./adapter-validation.js";
import { CodexStdioAppServerClient } from "./app-server-client.js";
import { buildManagedContextItems } from "./context-items.js";
import { CodexEventNormalizer } from "./normalize.js";
import { CodexSessionRegistry } from "./session-registry.js";
import {
  CodexAdapterError,
  type CodexAdapterOptions,
} from "./types.js";

export class CodexAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor = {
    kind: "descriptor",
    schemaVersion: 1,
    adapterId: CODEX_ADAPTER_ID,
    adapterVersion: CODEX_ADAPTER_VERSION,
    provider: "codex",
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
  private readonly sessions = new CodexSessionRegistry();

  constructor(private readonly options: CodexAdapterOptions) {
    this.repositoryRoot = resolve(options.repositoryRoot);
    this.now = options.now ?? (() => new Date());
    this.createEventId = options.createEventId ?? defaultEventId;
    this.createReceiptId = options.createReceiptId ?? defaultReceiptId;
    assertAdapterMessage(this.descriptor, "Codex adapter descriptor");
  }

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    assertAdapterMessage(request, "Codex start request");
    if (request.adapterId !== this.descriptor.adapterId) {
      throw new CodexAdapterError("session_mismatch", "Start request의 adapter ID가 Codex와 다릅니다.");
    }
    const client = await this.createClient();
    try {
      const thread = await client.startThread({
        cwd: this.repositoryRoot,
        approvalPolicy: this.options.approvalPolicy ?? "never",
        sandbox: this.options.sandbox ?? "read-only",
        ...(this.options.model === undefined ? {} : { model: this.options.model }),
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
        startedAt: timestamp(this.now, "Codex session 시작 시각", request.requestedAt),
      };
      assertAdapterMessage(session, "Codex session");
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
    assertAdapterMessage(envelope, "Codex context envelope");
    if (state.injectedTargetTurnIds.has(envelope.targetTurnId)) {
      throw new CodexAdapterError("invalid_request", "같은 target turn에 context를 두 번 주입할 수 없습니다.");
    }
    const items = await buildManagedContextItems(
      clone(state.session),
      clone(envelope),
      this.options.resolveArtifact,
    );
    await state.client.injectItems(session.providerSessionId, items);
    const acceptedAt = timestamp(this.now, "Codex context receipt 시각", envelope.createdAt);
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
      acceptedAt,
    };
    assertAdapterMessage(receipt, "Codex context receipt");
    state.injectedTargetTurnIds.add(envelope.targetTurnId);
    return clone(receipt);
  }

  async startTurn(session: AdapterSession, request: AdapterTurnRequest): Promise<AdapterTurn> {
    const state = this.sessions.get(session);
    assertAdapterMessage(request, "Codex turn request");
    if (
      request.adapterId !== this.descriptor.adapterId ||
      request.projectId !== session.projectId ||
      request.runId !== session.runId ||
      request.sessionId !== session.sessionId ||
      request.providerSessionId !== session.providerSessionId
    ) {
      throw new CodexAdapterError("session_mismatch", "Turn request가 managed Codex session과 다릅니다.");
    }
    if (!state.injectedTargetTurnIds.has(request.targetTurnId)) {
      throw new CodexAdapterError("invalid_request", "현재 target turn에 controlled context receipt가 없습니다.");
    }
    if (state.startedTargetTurnIds.has(request.targetTurnId) || state.activeProviderTurnId !== undefined) {
      throw new CodexAdapterError("invalid_request", "Codex turn이 이미 시작되었거나 실행 중입니다.");
    }
    const providerTurn = await state.client.startTurn(session.providerSessionId, request.instructions);
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
      acceptedAt: timestamp(this.now, "Codex turn 수락 시각", request.requestedAt),
    };
    assertAdapterMessage(turn, "Codex turn");
    return clone(turn);
  }

  async *events(
    session: AdapterSession,
    signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    const state = this.sessions.get(session);
    if (state.eventStreamClaimed) {
      throw new CodexAdapterError("invalid_request", "Codex event stream은 session마다 한 번만 열 수 있습니다.");
    }
    state.eventStreamClaimed = true;
    const normalizer = new CodexEventNormalizer({
      session: clone(state.session),
      repositoryRoot: this.repositoryRoot,
      adapterVersion: CODEX_ADAPTER_VERSION,
      now: this.now,
      createEventId: this.createEventId,
    });
    try {
      for await (const notification of state.client.notifications(signal)) {
        const normalized = normalizer.normalize(notification);
        if (normalized === null) continue;
        assertAdapterMessage(normalized, "Codex normalized event");
        if (
          normalized.type === "provider.turn.completed" ||
          normalized.type === "provider.turn.failed"
        ) {
          delete state.activeProviderTurnId;
        }
        yield clone(normalized);
      }
    } catch (error) {
      if (signal.aborted) return;
      const normalized = normalizer.normalize({
        method: "error",
        params: {
          threadId: session.providerSessionId,
          error: { code: error instanceof CodexAdapterError ? error.code : "provider_process_failed" },
          willRetry: false,
        },
      });
      if (normalized !== null) yield normalized;
    }
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
      throw new CodexAdapterError("session_mismatch", "Stop request가 managed Codex session과 다릅니다.");
    }
    try {
      if (request.reason === "cancelled" && state.activeProviderTurnId !== undefined) {
        await state.client.interruptTurn(session.providerSessionId, state.activeProviderTurnId);
      }
      await state.client.unsubscribe(session.providerSessionId);
      await state.client.close();
    } catch {
      await state.client.close().catch(() => undefined);
      throw new CodexAdapterError("provider_process_failed", "Codex session을 안전하게 종료하지 못했습니다.");
    }
    state.stopped = true;
    delete state.activeProviderTurnId;
    const result: AdapterStopResult = {
      kind: "stop_result",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: request.reason,
      stoppedAt: timestamp(this.now, "Codex session 종료 시각", request.requestedAt),
    };
    assertAdapterMessage(result, "Codex stop result");
    return clone(result);
  }

  private async createClient() {
    if (this.options.clientFactory !== undefined) return this.options.clientFactory();
    return CodexStdioAppServerClient.connect({
      executable: this.options.executable ?? "codex",
      cwd: this.repositoryRoot,
      requestTimeoutMs: this.options.requestTimeoutMs ?? 30_000,
    });
  }
}
