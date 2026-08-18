import {
  type AdapterContextEnvelope,
  type AdapterContextReceipt,
  type AdapterDescriptor,
  type AdapterNormalizedEvent,
  type AdapterSession,
  type AdapterStartRequest,
  type AdapterStopRequest,
  type AdapterStopResult,
} from "@roven/schemas";
import { describe, expect, it } from "vitest";

import {
  evaluateAdapterContract,
  type ProviderAdapter,
} from "../src/index.js";

const contentHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function descriptor(provider: string): AdapterDescriptor {
  return {
    kind: "descriptor",
    schemaVersion: 1,
    adapterId: `roven/${provider}`,
    adapterVersion: "0.0.0",
    provider,
    capabilities: {
      controlledContextInjection: "supported",
      toolCalls: "supported",
      commandExecution: "supported",
      fileChanges: "supported",
      contextCompaction: "unknown",
      sessionResume: "supported",
      usage: "unknown",
    },
  };
}

class FixtureAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor;

  constructor(
    provider: string,
    private readonly receiptHash: string | undefined = undefined,
    private readonly writingPolicyOverride: string | null | undefined = undefined,
  ) {
    this.descriptor = descriptor(provider);
  }

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    return {
      kind: "session",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      roleId: request.roleId,
      writingPolicyId:
        this.writingPolicyOverride === undefined
          ? request.writingPolicyId
          : this.writingPolicyOverride,
      provider: this.descriptor.provider,
      providerSessionId: `${this.descriptor.provider}-session-1`,
      startedAt: "2026-08-18T00:00:01Z",
    };
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    return {
      kind: "context_receipt",
      schemaVersion: 1,
      receiptId: "ctx_01234567",
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
        contentHash: this.receiptHash ?? document.contentHash,
        scope: document.scope,
        status: "injected" as const,
      })),
      acceptedAt: "2026-08-18T00:00:02Z",
    };
  }

  async *events(
    session: AdapterSession,
    _signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    yield {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: "evt_01234567",
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      type: "tool.called",
      occurredAt: "2026-08-18T00:00:02Z",
      payload: { toolName: "fixture" },
    };
  }

  async stop(
    session: AdapterSession,
    request: AdapterStopRequest,
  ): Promise<AdapterStopResult> {
    return {
      kind: "stop_result",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: request.reason,
      stoppedAt: "2026-08-18T00:00:04Z",
    };
  }
}

function fixture(provider: string) {
  const startRequest: AdapterStartRequest = {
    kind: "start_request",
    schemaVersion: 1,
    adapterId: `roven/${provider}`,
    projectId: "prj_01234567",
    runId: "run_01234567",
    sessionId: "ses_01234567",
    roleId: "developer",
    writingPolicyId: "writing_ko-kr-human",
    requestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    requestedAt: "2026-08-18T00:00:00Z",
  };
  const contextEnvelope: AdapterContextEnvelope = {
    kind: "context_envelope",
    schemaVersion: 1,
    envelopeId: "envelope-1",
    adapterId: `roven/${provider}`,
    projectId: startRequest.projectId,
    runId: startRequest.runId,
    sessionId: startRequest.sessionId,
    roleId: startRequest.roleId,
    writingPolicyId: startRequest.writingPolicyId,
    writingPolicyDocumentId: "doc_writing_policy",
    targetTurnId: "turn-1",
    contextGeneration: 0,
    documents: [
      {
        documentId: "doc_01234567",
        path: "AGENTS.md",
        contentHash,
        byteCount: 42,
        scope: { kind: "full" },
        delivery: { kind: "inline", content: "fixture document" },
      },
      {
        documentId: "doc_writing_policy",
        path: ".roven/policies/writing.ko-KR.json",
        contentHash:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        byteCount: 84,
        scope: { kind: "full" },
        delivery: { kind: "inline", content: "fixture writing policy" },
      },
    ],
    createdAt: "2026-08-18T00:00:01Z",
  };

  return {
    expectedProvider: provider,
    startRequest,
    contextEnvelope,
    stopReason: "completed" as const,
  };
}

describe.each(["codex", "claude"])("%s common adapter contract", (provider) => {
  it("passes the provider-neutral lifecycle", async () => {
    const report = await evaluateAdapterContract(new FixtureAdapter(provider), fixture(provider));
    expect(report).toEqual({ passed: true, violations: [] });
  });
});

describe("adapter contract evidence integrity", () => {
  it("does not wait for a long-lived event stream to finish", async () => {
    class LongLivedAdapter extends FixtureAdapter {
      override async *events(
        session: AdapterSession,
        signal: AbortSignal,
      ): AsyncIterable<AdapterNormalizedEvent> {
        yield* super.events(session, signal);
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      }
    }

    await expect(
      evaluateAdapterContract(new LongLivedAdapter("claude"), fixture("claude")),
    ).resolves.toEqual({ passed: true, violations: [] });
  });

  it("reports an adapter that never produces the required event", async () => {
    class SilentAdapter extends FixtureAdapter {
      override async *events(
        _session: AdapterSession,
        signal: AbortSignal,
      ): AsyncIterable<AdapterNormalizedEvent> {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      }
    }
    const silentFixture = { ...fixture("codex"), eventTimeoutMs: 20 };
    const report = await evaluateAdapterContract(new SilentAdapter("codex"), silentFixture);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "normalized_event_timeout" }),
    );
  });

  it("rejects a receipt that substitutes a different document hash", async () => {
    const report = await evaluateAdapterContract(
      new FixtureAdapter(
        "codex",
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ),
      fixture("codex"),
    );

    expect(report.passed).toBe(false);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "context_receipt_mismatch" }),
    );
  });

  it("rejects a Claude session that drops the selected writing policy", async () => {
    const report = await evaluateAdapterContract(
      new FixtureAdapter("claude", undefined, null),
      fixture("claude"),
    );

    expect(report.passed).toBe(false);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "session_mismatch" }),
    );
  });

  it("rejects a Claude envelope that names a writing policy without its document", async () => {
    const incompleteFixture = fixture("claude");
    incompleteFixture.contextEnvelope.documents =
      incompleteFixture.contextEnvelope.documents.filter(
        (document) => document.documentId !== "doc_writing_policy",
      );

    const report = await evaluateAdapterContract(
      new FixtureAdapter("claude"),
      incompleteFixture,
    );

    expect(report.passed).toBe(false);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "context_envelope_mismatch" }),
    );
  });
});
