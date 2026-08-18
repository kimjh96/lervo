import { resolve } from "node:path";

import {
  createAdapterTurnResult,
  inspectManagedWriteDecisionBinding,
  type ProviderAdapter,
  type ProviderManagedWriteBridge,
} from "@roven/adapter-contract";
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
  captureCodexWriteApproval,
  captureCodexWriteCompletion,
  captureCodexWriteProposal,
  codexWriteApprovalRequestId,
} from "./managed-write.js";
import { captureCodexTurnResult } from "./turn-result.js";
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
        "Codex managed session의 실행 모드와 sandbox·approval 설정이 다릅니다.",
      );
    }
    const client = await this.createClient();
    try {
      const thread = await client.startThread({
        cwd: this.repositoryRoot,
        approvalPolicy,
        sandbox,
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
        executionMode: request.executionMode,
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

  async attachManagedWriteBridge(
    session: AdapterSession,
    bridge: ProviderManagedWriteBridge,
  ): Promise<void> {
    const state = this.sessions.get(session);
    if (state.managedWriteBridge !== undefined) {
      throw new CodexAdapterError("invalid_request", "Managed write bridge가 이미 연결되었습니다.");
    }
    state.managedWriteBridge = bridge;
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
    state.activeTurn = clone(turn);
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
      eventLoop: for await (const notification of state.client.notifications(signal)) {
        const activeTurn = state.activeTurn;
        if (activeTurn !== undefined) {
          const proposal = captureCodexWriteProposal({
            raw: notification,
            repositoryRoot: this.repositoryRoot,
            providerSessionId: session.providerSessionId,
            providerTurnId: activeTurn.providerTurnId,
          });
          if (proposal !== null) {
            state.writeProposals.set(proposal.providerItemId, proposal);
          }
          for (const candidate of state.writeProposals.values()) {
            const approval = captureCodexWriteApproval({
              raw: notification,
              session,
              turn: activeTurn,
              proposal: candidate,
              now: this.now,
            });
            if (approval === null) continue;
            const decision =
              state.managedWriteBridge === undefined
                ? null
                : await state.managedWriteBridge.authorize(approval.request);
            if (decision !== null) {
              assertAdapterMessage(decision, "Codex managed write decision");
              const binding = inspectManagedWriteDecisionBinding({
                request: approval.request,
                decision,
              });
              if (!binding.passed) {
                throw new CodexAdapterError(
                  "provider_protocol_failed",
                  "Managed write 결정이 Codex 요청과 다릅니다.",
                );
              }
            }
            const allowed = decision?.decision === "allow";
            await state.client.respondFileChangeApproval(
              approval.requestId,
              allowed ? "accept" : "decline",
            );
            if (allowed) {
              state.approvedWrites.set(candidate.providerItemId, approval.request);
            }
            state.writeProposals.delete(candidate.providerItemId);
            continue eventLoop;
          }
          const unmatchedApproval = codexWriteApprovalRequestId(notification);
          if (unmatchedApproval !== null) {
            await state.client.respondFileChangeApproval(unmatchedApproval, "decline");
            continue;
          }
          for (const request of state.approvedWrites.values()) {
            const completion = captureCodexWriteCompletion({
              raw: notification,
              request,
              now: this.now,
            });
            if (completion === null) continue;
            if (state.managedWriteBridge === undefined) {
              throw new CodexAdapterError(
                "provider_protocol_failed",
                "승인된 Codex 변경에 managed write bridge가 없습니다.",
              );
            }
            await state.managedWriteBridge.complete(completion);
            state.approvedWrites.delete(request.providerItemId);
          }
        }
        const normalized = normalizer.normalize(notification);
        const captured = captureCodexTurnResult({
          raw: notification,
          providerSessionId: session.providerSessionId,
          now: this.now,
        });
        if (captured !== null) {
          state.turnResults.set(captured.providerTurnId, {
            content: captured.content,
            producedAt: captured.producedAt,
          });
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
          error: { code: error instanceof CodexAdapterError ? error.code : "provider_process_failed" },
          willRetry: false,
        },
      });
      if (normalized !== null) yield normalized;
    }
  }

  async getTurnResult(
    session: AdapterSession,
    turn: AdapterTurn,
  ): Promise<AdapterTurnResult> {
    const state = this.sessions.get(session);
    assertAdapterMessage(turn, "Codex turn");
    if (
      turn.adapterId !== session.adapterId ||
      turn.projectId !== session.projectId ||
      turn.runId !== session.runId ||
      turn.sessionId !== session.sessionId ||
      turn.providerSessionId !== session.providerSessionId
    ) {
      throw new CodexAdapterError("session_mismatch", "Turn result 요청이 Codex session과 다릅니다.");
    }
    const captured = state.turnResults.get(turn.providerTurnId);
    if (captured === undefined) {
      throw new CodexAdapterError(
        "provider_protocol_failed",
        "완료된 Codex turn의 최종 결과가 없습니다.",
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
