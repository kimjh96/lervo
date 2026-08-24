import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  ManagedContextCoverageError,
  projectManagedContextCoverage,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const resultHash = `sha256:${"b".repeat(64)}`;
const scope = { kind: "full" } as const;

function event(
  seq: number,
  type: EventEnvelope["type"],
  payload: Record<string, unknown>,
  actor: EventEnvelope["actor"] = { kind: "system" },
): EventEnvelope {
  return {
    eventId: `evt_coverage_${String(seq).padStart(8, "0")}`,
    projectId: "prj_coverage_0001",
    runId: "run_coverage_0001",
    sessionId: "ses_coverage_0001",
    seq,
    type,
    occurredAt: `2026-08-24T00:00:${String(seq).padStart(2, "0")}Z`,
    actor,
    schemaVersion: 1,
    policyVersion: hash,
    payload,
    previousHash: seq === 1 ? null : hash,
    eventHash: hash,
  };
}

function completeEvents(): EventEnvelope[] {
  const provider = { kind: "provider", provider: "codex" } as const;
  return [
    event(1, "adapter.started", {
      adapterId: "lervo/codex",
      adapterVersion: "1",
      providerSessionId: "provider-session-1",
      executionMode: "read_only",
      capabilities: {},
    }, provider),
    event(2, "context.recommended", { documentId: "doc_context_00000001" }),
    event(3, "context.selected", {
      documentId: "doc_context_00000001",
      reasonCode: "path_rule",
      ruleId: "repository.path",
      required: true,
      scope,
    }),
    event(4, "context.selected", {
      documentId: "doc_context_00000001",
      reasonCode: "role_required",
      ruleId: "developer.instructions",
      required: true,
      scope,
    }),
    event(5, "document.loaded", {
      evidenceReceiptId: "ctx_loaded_00000001",
      documentId: "doc_context_00000001",
      contentHash: hash,
      byteCount: 10,
      scope,
      sourceRevision: "working-tree:1",
    }),
    event(6, "context.injected", {
      receiptId: "ctx_adapter_00000001",
      evidenceReceiptIds: ["ctx_injected_00000001"],
      envelopeId: "envelope-1",
      documentIds: ["doc_context_00000001"],
      targetTurnId: "target-turn-1",
      contextGeneration: 0,
      adapterId: "lervo/codex",
      providerSessionId: "provider-session-1",
      documents: [{
        evidenceReceiptId: "ctx_injected_00000001",
        documentId: "doc_context_00000001",
        contentHash: hash,
        scope,
      }],
    }, provider),
    event(7, "adapter.result.captured", {
      adapterId: "lervo/codex",
      providerSessionId: "provider-session-1",
      targetTurnId: "target-turn-1",
      providerTurnId: "provider-turn-1",
      resultDigest: resultHash,
      byteCount: 20,
      mediaType: "text/markdown; charset=utf-8",
      referenceTelemetry: "supported",
    }, provider),
    event(8, "context.referenced", {
      evidenceReceiptId: "ctx_reference_0000001",
      injectedEvidenceReceiptId: "ctx_injected_00000001",
      adapterReceiptId: "ctx_adapter_00000001",
      sourceEventId: "evt_coverage_00000007",
      documentId: "doc_context_00000001",
      contentHash: hash,
      scope,
      provider: "codex",
      providerSessionId: "provider-session-1",
      targetTurnId: "target-turn-1",
      providerTurnId: "provider-turn-1",
      contextGeneration: 0,
      referenceKind: "output_citation",
      citation: `lervo-e4:doc_context_00000001:${hash}`,
    }, provider),
    event(9, "run.completed", {}),
  ];
}

describe("managed context coverage projector", () => {
  it("reconstructs E1-E4 and keeps every selection ground", () => {
    const report = projectManagedContextCoverage(completeEvents())!;
    expect(report).toMatchObject({
      executionMode: "managed",
      provider: "codex",
      status: "completed",
      capabilities: {
        controlledContextDelivery: "observed",
        explicitOutputReference: "observed",
        internalUse: "unsupported",
      },
      coverage: {
        delivery: { numerator: 1, denominator: 1, value: 1 },
        explicitReference: { numerator: 1, denominator: 1, value: 1 },
        candidateSelection: { numerator: 1, denominator: 1, value: 1 },
      },
    });
    expect(report.documents).toEqual([
      expect.objectContaining({
        highestEvidence: "referenced",
        missingStages: [],
        selectionReasons: [
          expect.objectContaining({ reasonCode: "path_rule" }),
          expect.objectContaining({ reasonCode: "role_required" }),
        ],
      }),
    ]);
  });

  it("keeps unresolved required versions and unsupported reference telemetry nullable", () => {
    const provider = { kind: "provider", provider: "claude" } as const;
    const report = projectManagedContextCoverage([
      event(1, "adapter.started", {
        adapterId: "lervo/claude",
        adapterVersion: "1",
        providerSessionId: "provider-session-1",
        executionMode: "read_only",
        capabilities: {},
      }, provider),
      event(2, "context.selected", {
        documentId: "doc_context_00000001",
        reasonCode: "role_required",
        ruleId: "developer.instructions",
        required: true,
        scope,
      }),
    ])!;
    expect(report.coverage.delivery).toEqual({
      numerator: 0,
      denominator: 1,
      value: null,
      reason: "required_version_unresolved",
    });
    expect(report.coverage.explicitReference.reason).toBe("reference_telemetry_unavailable");
    expect(report.documents[0]?.missingStages).toEqual(["E2", "E3", "E4"]);
  });

  it("rejects E4 that is not bound to its E3 document version", () => {
    const events = completeEvents();
    events[7] = event(8, "context.referenced", {
      ...events[7]!.payload,
      contentHash: `sha256:${"c".repeat(64)}`,
    }, { kind: "provider", provider: "codex" });
    expect(() => projectManagedContextCoverage(events)).toThrow(ManagedContextCoverageError);
  });
});
