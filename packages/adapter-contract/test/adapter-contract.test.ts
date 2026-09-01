import { createHash } from "node:crypto";

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
  type ResourceAccountingDescriptor,
} from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  evaluateAdapterContract,
  type ProviderAdapter,
  type ProviderManagedWriteBridge,
} from "../src/index.js";

const contentHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function resourceAccounting(provider: string): ResourceAccountingDescriptor {
  return {
    kind: "resource_accounting_descriptor",
    schemaVersion: 1,
    provider,
    adapterId: `lervo/${provider}`,
    adapterVersion: "0.0.0",
    accountingMode: "turn_cumulative",
    observationSupport: "unavailable",
    unavailableReason: "fixture_usage_unavailable",
    normalizationId: "fixture_usage_v1",
    nativeCounterSemanticsId: "fixture_counter_v1",
    model: null,
    serviceTier: null,
  };
}

function descriptor(provider: string): AdapterDescriptor {
  return {
    kind: "descriptor",
    schemaVersion: 1,
    adapterId: `lervo/${provider}`,
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
  readonly resourceAccounting: ResourceAccountingDescriptor;

  constructor(
    provider: string,
    private readonly receiptHash: string | undefined = undefined,
    private readonly writingPolicyOverride: string | null | undefined = undefined,
  ) {
    this.descriptor = descriptor(provider);
    this.resourceAccounting = resourceAccounting(provider);
  }

  async startTurn(
    session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: (turn: AdapterTurn) => void,
  ): Promise<AdapterTurn> {
    const turn: AdapterTurn = {
      kind: "turn",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId: "provider-turn-1",
      acceptedAt: "2026-08-18T00:00:02Z",
    };
    accepted(structuredClone(turn));
    return turn;
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
      executionMode: request.executionMode,
      effectiveCapabilities: {
        ...this.descriptor.capabilities,
        fileChanges: request.executionMode === "managed_write" ? "supported" : "unsupported",
      },
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
        documentRole: document.documentRole,
        referenceEligible: document.referenceEligible,
        status: "injected" as const,
      })),
      acceptedAt: "2026-08-18T00:00:02Z",
    };
  }

  async attachManagedWriteBridge(
    _session: AdapterSession,
    _bridge: ProviderManagedWriteBridge,
  ): Promise<void> {}

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
      type: "provider.tool.called",
      occurredAt: "2026-08-18T00:00:02Z",
      payload: {
        providerItemId: "item-1",
        toolName: "fixture",
        inputDigest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        status: "completed",
        durationMs: 1,
      },
    };
    yield {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: "evt_01234568",
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      type: "provider.turn.completed",
      occurredAt: "2026-08-18T00:00:03Z",
      payload: {
        providerTurnId: "provider-turn-1",
        status: "completed",
        durationMs: 1,
      },
    };
  }

  async getTurnResult(session: AdapterSession, turn: AdapterTurn): Promise<AdapterTurnResult> {
    const content = "fixture result";
    const bytes = Buffer.from(content, "utf8");
    return {
      kind: "turn_result",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      targetTurnId: turn.targetTurnId,
      providerTurnId: turn.providerTurnId,
      mediaType: "text/markdown; charset=utf-8",
      content,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      byteCount: bytes.byteLength,
      producedAt: "2026-08-18T00:00:03Z",
    };
  }

  async stop(session: AdapterSession, request: AdapterStopRequest): Promise<AdapterStopResult> {
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
    adapterId: `lervo/${provider}`,
    projectId: "prj_01234567",
    runId: "run_01234567",
    sessionId: "ses_01234567",
    roleId: "developer",
    writingPolicyId: "writing_en-human",
    requestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    executionMode: "read_only",
    requestedAt: "2026-08-18T00:00:00Z",
  };
  const contextEnvelope: AdapterContextEnvelope = {
    kind: "context_envelope",
    schemaVersion: 1,
    envelopeId: "envelope-1",
    adapterId: `lervo/${provider}`,
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
        documentRole: "task_evidence",
        referenceEligible: true,
        delivery: { kind: "inline", content: "fixture document" },
      },
      {
        documentId: "doc_writing_policy",
        path: ".lervo/policies/writing.ko-KR.json",
        contentHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        byteCount: 84,
        scope: { kind: "full" },
        documentRole: "governance_context",
        referenceEligible: false,
        delivery: { kind: "inline", content: "fixture writing policy" },
      },
    ],
    createdAt: "2026-08-18T00:00:01Z",
  };
  const turnRequest: AdapterTurnRequest = {
    kind: "turn_request",
    schemaVersion: 1,
    adapterId: `lervo/${provider}`,
    projectId: startRequest.projectId,
    runId: startRequest.runId,
    sessionId: startRequest.sessionId,
    providerSessionId: `${provider}-session-1`,
    targetTurnId: contextEnvelope.targetTurnId,
    instructions: "fixture task",
    requestedAt: "2026-08-18T00:00:02Z",
  };

  return {
    expectedProvider: provider,
    startRequest,
    contextEnvelope,
    turnRequest,
    stopReason: "completed" as const,
    expectedResultContent: "fixture result",
    expectedEventCount: 2,
  };
}

describe.each(["codex", "claude"])("%s common adapter contract", (provider) => {
  it("passes the provider-neutral lifecycle", async () => {
    const report = await evaluateAdapterContract(new FixtureAdapter(provider), fixture(provider));
    expect(report).toEqual({ passed: true, violations: [] });
  });

  it("requires an exact provider confirmation for every requested activation", async () => {
    const data = fixture(provider);
    data.startRequest.capabilityActivations = [
      {
        kind: "capability_activation_request",
        schemaVersion: 1,
        capabilityId: "research/search",
        capabilityKind: "mcp_server",
        version: "1.0.0",
        contentHash: `sha256:${"a".repeat(64)}`,
        runtime: {
          kind: "mcp_http",
          serverName: "research-search",
          url: "https://mcp.example.test/",
          bearerTokenCredential: null,
          timeoutMs: 5000,
        },
      },
    ];
    const report = await evaluateAdapterContract(new FixtureAdapter(provider), data);
    expect(report.violations).toContainEqual(
      expect.objectContaining({
        code: "session_mismatch",
        detail: expect.stringContaining("activation receipt count"),
      }),
    );
  });
});

describe("adapter contract evidence integrity", () => {
  it("rejects a turn result whose declared bytes do not match its content", async () => {
    class InvalidResultAdapter extends FixtureAdapter {
      override async getTurnResult(session: AdapterSession, turn: AdapterTurn) {
        const result = await super.getTurnResult(session, turn);
        return { ...result, byteCount: result.byteCount + 1 };
      }
    }
    const report = await evaluateAdapterContract(
      new InvalidResultAdapter("codex"),
      fixture("codex"),
    );
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "turn_result_mismatch" }),
    );
  });

  it("does not wait for a long-lived event stream to finish", async () => {
    class LongLivedAdapter extends FixtureAdapter {
      override async *events(
        session: AdapterSession,
        signal: AbortSignal,
      ): AsyncIterable<AdapterNormalizedEvent> {
        yield* super.events(session, signal);
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
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
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
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

  it("rejects a receipt that changes document scope", async () => {
    class ScopeChangingAdapter extends FixtureAdapter {
      override async injectContext(
        session: AdapterSession,
        envelope: AdapterContextEnvelope,
      ): Promise<AdapterContextReceipt> {
        const receipt = await super.injectContext(session, envelope);
        receipt.documents[0] = {
          ...receipt.documents[0]!,
          scope: { kind: "sections", sections: ["different"] },
        };
        return receipt;
      }
    }

    const report = await evaluateAdapterContract(
      new ScopeChangingAdapter("codex"),
      fixture("codex"),
    );
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "context_receipt_mismatch" }),
    );
  });

  it("rejects a receipt that changes the typed document role", async () => {
    class RoleChangingAdapter extends FixtureAdapter {
      override async injectContext(
        session: AdapterSession,
        envelope: AdapterContextEnvelope,
      ): Promise<AdapterContextReceipt> {
        const receipt = await super.injectContext(session, envelope);
        receipt.documents[0] = {
          ...receipt.documents[0]!,
          documentRole: "governance_context",
          referenceEligible: false,
        };
        return receipt;
      }
    }

    const report = await evaluateAdapterContract(
      new RoleChangingAdapter("codex"),
      fixture("codex"),
    );
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "context_receipt_mismatch" }),
    );
  });

  it("rejects a receipt that changes claim reference eligibility", async () => {
    class EligibilityChangingAdapter extends FixtureAdapter {
      override async injectContext(
        session: AdapterSession,
        envelope: AdapterContextEnvelope,
      ): Promise<AdapterContextReceipt> {
        const receipt = await super.injectContext(session, envelope);
        receipt.documents[0] = {
          ...receipt.documents[0]!,
          referenceEligible: false,
        };
        return receipt;
      }
    }

    const report = await evaluateAdapterContract(
      new EligibilityChangingAdapter("codex"),
      fixture("codex"),
    );
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "context_receipt_mismatch" }),
    );
  });

  it("rejects duplicate receipt document IDs", async () => {
    class DuplicateDocumentAdapter extends FixtureAdapter {
      override async injectContext(
        session: AdapterSession,
        envelope: AdapterContextEnvelope,
      ): Promise<AdapterContextReceipt> {
        const receipt = await super.injectContext(session, envelope);
        receipt.documents[1] = { ...receipt.documents[0]! };
        return receipt;
      }
    }

    const report = await evaluateAdapterContract(
      new DuplicateDocumentAdapter("claude"),
      fixture("claude"),
    );
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
    expect(report.violations).toContainEqual(expect.objectContaining({ code: "session_mismatch" }));
  });

  it("rejects a Claude envelope that names a writing policy without its document", async () => {
    const incompleteFixture = fixture("claude");
    incompleteFixture.contextEnvelope.documents =
      incompleteFixture.contextEnvelope.documents.filter(
        (document) => document.documentId !== "doc_writing_policy",
      );

    const report = await evaluateAdapterContract(new FixtureAdapter("claude"), incompleteFixture);

    expect(report.passed).toBe(false);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "context_envelope_mismatch" }),
    );
  });

  it("rejects an envelope created before its managed session", async () => {
    const backdatedFixture = fixture("codex");
    backdatedFixture.contextEnvelope.createdAt = "2026-08-17T23:59:59Z";

    const report = await evaluateAdapterContract(new FixtureAdapter("codex"), backdatedFixture);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "context_envelope_mismatch" }),
    );
  });

  it("rejects a turn that was returned without an acceptance announcement", async () => {
    class UnannouncedTurnAdapter extends FixtureAdapter {
      override async startTurn(
        session: AdapterSession,
        request: AdapterTurnRequest,
        _accepted: (turn: AdapterTurn) => void,
      ): Promise<AdapterTurn> {
        return super.startTurn(session, request, () => undefined);
      }
    }

    const report = await evaluateAdapterContract(
      new UnannouncedTurnAdapter("codex"),
      fixture("codex"),
    );
    expect(report.violations).toContainEqual(expect.objectContaining({ code: "turn_mismatch" }));
  });

  it("rejects session capabilities that exceed the adapter descriptor", async () => {
    class OverbroadSessionAdapter extends FixtureAdapter {
      constructor() {
        super("claude");
        this.descriptor.capabilities.commandExecution = "unsupported";
      }

      override async start(request: AdapterStartRequest): Promise<AdapterSession> {
        const session = await super.start(request);
        session.effectiveCapabilities.commandExecution = "supported";
        return session;
      }
    }

    const report = await evaluateAdapterContract(new OverbroadSessionAdapter(), fixture("claude"));
    expect(report.violations).toContainEqual(expect.objectContaining({ code: "session_mismatch" }));
  });
});
