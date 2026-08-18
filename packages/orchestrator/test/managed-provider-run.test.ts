import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ProviderAdapter } from "@roven/adapter-contract";
import { SQLiteEventStore } from "@roven/event-store-sqlite";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterDescriptor,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterStopRequest,
  AdapterTurnRequest,
  DocumentRegistry,
} from "@roven/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  ManagedProviderRunCoordinator,
  ManagedProviderRunError,
  type ManagedEventStore,
} from "../src/index.js";
import { policyVersion, projectId, role, runId, sessionId } from "./fixture.js";

const roots: string[] = [];
const requestDigest =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}_${String(++value).padStart(8, "0")}`;
}

function clock() {
  let value = Date.parse("2026-08-18T01:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "roven-provider-run-"));
  roots.push(root);
  await mkdir(resolve(root, ".roven/state"), { recursive: true });
  await mkdir(resolve(root, "src"), { recursive: true });
  await writeFile(resolve(root, "AGENTS.md"), "저장소 작업 지침입니다.\n");
  const store = await SQLiteEventStore.open({
    path: resolve(root, ".roven/state/events.sqlite"),
    projectId,
  });
  return { root, store };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeManagedAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly calls: string[] = [];
  stopReason: AdapterStopRequest["reason"] | undefined;
  private session: AdapterSession | undefined;
  private turnId: string | undefined;
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
    } = {},
  ) {
    this.descriptor = {
      kind: "descriptor",
      schemaVersion: 1,
      adapterId: `roven/${provider}`,
      adapterVersion: "fixture-1",
      provider,
      capabilities: {
        controlledContextInjection: "supported",
        toolCalls: "supported",
        commandExecution: "supported",
        fileChanges: provider === "codex" ? "supported" : "unknown",
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
      startedAt: request.requestedAt,
    };
    return structuredClone(this.session);
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    this.calls.push("injectContext");
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
        status: "injected" as const,
      })),
      acceptedAt: envelope.createdAt,
    };
  }

  async startTurn(_session: AdapterSession, request: AdapterTurnRequest) {
    this.calls.push("startTurn");
    this.turnId = `${this.descriptor.provider}-turn-1`;
    await this.options.mutate?.();
    this.acceptTurn();
    this.releaseTurn();
    return {
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
  }

  async *events(_session: AdapterSession, signal: AbortSignal): AsyncIterable<AdapterNormalizedEvent> {
    const base = () => ({
      kind: "normalized_event" as const,
      schemaVersion: 1 as const,
      projectId,
      runId,
      sessionId,
      providerSessionId: `${this.descriptor.provider}-session-1`,
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
      new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
    ]);
    if (signal.aborted) return;
    yield {
      ...base(),
      eventId: `evt_${this.descriptor.provider}turn1`,
      type: "provider.turn.started",
      payload: { providerTurnId: this.turnId as string },
    };
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

  async stop(_session: AdapterSession, request: AdapterStopRequest) {
    this.calls.push("stop");
    this.stopReason = request.reason;
    return {
      kind: "stop_result" as const,
      schemaVersion: 1 as const,
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      providerSessionId: request.providerSessionId,
      status: request.reason,
      stoppedAt: request.requestedAt,
    };
  }
}

function runInput() {
  const registry: DocumentRegistry = { schemaVersion: 1, documents: {} };
  return {
    requestDigest,
    risk: "low",
    instructions: "저장소를 읽고 결과를 설명합니다.",
    targetTurnId: "turn-managed-provider-1",
    context: {
      registry,
      role: { ...role, capabilities: { ...role.capabilities, "filesystem.write": "deny" as const } },
      expectedPaths: ["src/result.ts"],
      documentRules: {},
      publications: [],
      handoffs: [],
      createReceiptId: sequence("ctx_selected"),
    },
    writingPolicy: null,
    createEnvelopeId: () => "envelope-provider-run-1",
    createEvidenceReceiptId: sequence("ctx_injected"),
  };
}

function coordinator(
  adapter: ProviderAdapter,
  root: string,
  store: SQLiteEventStore,
) {
  return new ManagedProviderRunCoordinator({
    adapter,
    coordinates: { projectId, runId, sessionId, roleId: role.roleId },
    policyVersion,
    events: store,
    now: clock(),
    createEventId: sequence("evt_managedrun"),
  });
}

describe("managed provider run coordinator", () => {
  it.each(["codex", "claude"] as const)(
    "runs the %s lifecycle only after controlled context injection",
    async (provider) => {
      const data = await fixture();
      const adapter = new FakeManagedAdapter(provider);
      const result = await coordinator(adapter, data.root, data.store).run({
        ...runInput(),
        repositoryRoot: data.root,
      });

      expect(result).toMatchObject({
        status: "completed",
        contextGeneration: 0,
        beforeRevision: result.afterRevision,
        unmanagedPaths: [],
      });
      expect(adapter.calls).toEqual(["start", "injectContext", "startTurn", "stop"]);
      expect(adapter.stopReason).toBe("completed");
      expect(data.store.list({ runId }).map((event) => event.type)).toEqual([
        "run.requested",
        "run.resolved",
        "adapter.started",
        "context.selected",
        "context.selected",
        "document.loaded",
        "context.injected",
        "tool.called",
        "command.executed",
        "adapter.stopped",
        "run.completed",
      ]);
      const serialized = JSON.stringify(data.store.list({ runId }));
      expect(serialized).not.toContain("저장소를 읽고 결과를 설명합니다");
      expect(data.store.verifyIntegrity().valid).toBe(true);
      data.store.close();
    },
  );

  it("invalidates E3 on provider compaction without pretending the turn failed", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("claude", { compact: true });
    const result = await coordinator(adapter, data.root, data.store).run({
      ...runInput(),
      repositoryRoot: data.root,
    });
    expect(result.contextGeneration).toBe(1);
    expect(data.store.list({ runId }).map((event) => event.type)).toContain("context.invalidated");
    expect(
      data.store.list({ runId }).find((event) => event.type === "context.invalidated")?.payload,
    ).toMatchObject({ reason: "context_compacted", contextGeneration: 0 });
    data.store.close();
  });

  it("records a persistent provider-side change as unmanaged and fails the run", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("codex", {
      mutate: () => writeFile(resolve(data.root, "src/result.ts"), "unmanaged bytes\n"),
    });
    const run = coordinator(adapter, data.root, data.store).run({
      ...runInput(),
      repositoryRoot: data.root,
    });
    await expect(run).rejects.toEqual(
      expect.objectContaining<Partial<ManagedProviderRunError>>({
        code: "unmanaged_change_detected",
        paths: ["src/result.ts"],
      }),
    );
    expect(data.store.list({ runId }).map((event) => event.type)).toEqual(
      expect.arrayContaining(["unmanaged_change.detected", "run.failed"]),
    );
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain("file.changed");
    expect(data.store.list({ runId }).at(-2)?.payload).toMatchObject({
      paths: ["src/result.ts"],
    });
    data.store.close();
  });

  it("interrupts and stops the provider when the caller cancels the run", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("claude", { hang: true });
    const controller = new AbortController();
    const run = coordinator(adapter, data.root, data.store).run({
      ...runInput(),
      repositoryRoot: data.root,
      signal: controller.signal,
    });
    await adapter.turnAccepted;
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
    expect(adapter.stopReason).toBe("cancelled");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "cancelled",
      retryable: false,
    });
    data.store.close();
  });

  it("fails before provider startup when the initial telemetry transaction cannot commit", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("codex");
    const events: ManagedEventStore = {
      transact: () => {
        throw new Error("fixture storage failure");
      },
    };
    const run = new ManagedProviderRunCoordinator({
      adapter,
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      policyVersion,
      events,
      now: clock(),
      createEventId: sequence("evt_managedrun"),
    }).run({ ...runInput(), repositoryRoot: data.root });

    await expect(run).rejects.toMatchObject({ code: "telemetry_recording_failed" });
    expect(adapter.calls).toEqual([]);
    data.store.close();
  });

  it("rejects a write-capable role before recording or starting a provider", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = runInput();
    const run = coordinator(adapter, data.root, data.store).run({
      ...input,
      repositoryRoot: data.root,
      context: {
        ...input.context,
        role,
      },
    });

    await expect(run).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(adapter.calls).toEqual([]);
    expect(data.store.list({ runId })).toEqual([]);
    data.store.close();
  });

  it("rejects a terminal signal that belongs to another provider turn", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("codex", { terminalTurnId: "foreign-turn" });
    const run = coordinator(adapter, data.root, data.store).run({
      ...runInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(adapter.stopReason).toBe("failed");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "contract_validation_failed",
    });
    data.store.close();
  });

  it("classifies an adapter event stream failure separately from a failed turn", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("codex", { streamFailure: true });
    const run = coordinator(adapter, data.root, data.store).run({
      ...runInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "provider_stream_failed" });
    expect(adapter.stopReason).toBe("failed");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "provider_stream_failed",
      retryable: true,
    });
    data.store.close();
  });

  it("does not ignore an invalid provider signal that follows the terminal event", async () => {
    const data = await fixture();
    const adapter = new FakeManagedAdapter("claude", { postTerminalMismatch: true });
    const run = coordinator(adapter, data.root, data.store).run({
      ...runInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(adapter.stopReason).toBe("failed");
    data.store.close();
  });
});
