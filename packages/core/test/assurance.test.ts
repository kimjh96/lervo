import type { ContextEvidence } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { assuranceLevels, evaluateWriteContext } from "../src/index.js";

const contentHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const coordinates = {
  projectId: "prj_01234567",
  runId: "run_01234567",
  sessionId: "ses_01234567",
  contextGeneration: 2,
} as const;

function evidence(): ContextEvidence[] {
  return [
    {
      receiptId: "ctx_01234567",
      projectId: coordinates.projectId,
      runId: coordinates.runId,
      sessionId: coordinates.sessionId,
      documentId: "doc_01234567",
      state: "selected",
      recordedAt: "2026-08-18T00:00:00Z",
      required: true,
      scope: { kind: "full" },
      policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      reasonCode: "explicit_instruction",
      ruleId: "root-agents",
    },
    {
      receiptId: "ctx_12345678",
      projectId: coordinates.projectId,
      runId: coordinates.runId,
      sessionId: coordinates.sessionId,
      documentId: "doc_01234567",
      state: "loaded",
      recordedAt: "2026-08-18T00:00:01Z",
      scope: { kind: "full" },
      contentHash,
      byteCount: 42,
      sourceRevision: "working-tree",
    },
    {
      receiptId: "ctx_23456789",
      projectId: coordinates.projectId,
      runId: coordinates.runId,
      sessionId: coordinates.sessionId,
      documentId: "doc_01234567",
      state: "injected",
      recordedAt: "2026-08-18T00:00:02Z",
      scope: { kind: "full" },
      contentHash,
      provider: "codex",
      providerSessionId: "provider-session-1",
      adapterId: "lervo/codex",
      adapterReceiptId: "ctx_adapter_01234567",
      envelopeId: "envelope-1",
      targetTurnId: "turn-1",
      contextGeneration: coordinates.contextGeneration,
      controlledInput: true,
    },
  ];
}

describe("context assurance gate", () => {
  it("keeps selected, loaded, injected, and referenced as distinct levels", () => {
    expect(assuranceLevels).toEqual({
      discovered: "E0",
      selected: "E1",
      loaded: "E2",
      injected: "E3",
      referenced: "E4",
    });
  });

  it("opens the write gate only for a current E3 chain", () => {
    expect(
      evaluateWriteContext({
        coordinates,
        requiredDocuments: [{ documentId: "doc_01234567", contentHash, scope: { kind: "full" } }],
        evidence: evidence(),
      }),
    ).toEqual({ allowed: true, assurance: "E3", missing: [] });
  });

  it("rejects injection without a loaded receipt", () => {
    const injectedOnly = evidence().filter((item) => item.state !== "loaded");
    const decision = evaluateWriteContext({
      coordinates,
      requiredDocuments: [{ documentId: "doc_01234567", contentHash, scope: { kind: "full" } }],
      evidence: injectedOnly,
    });

    expect(decision).toMatchObject({
      allowed: false,
      assurance: "E1",
      failure: "required_context_missing",
      missing: [{ reason: "not_loaded" }],
    });
  });

  it("rejects a receipt from an earlier context generation", () => {
    const decision = evaluateWriteContext({
      coordinates: { ...coordinates, contextGeneration: 3 },
      requiredDocuments: [{ documentId: "doc_01234567", contentHash, scope: { kind: "full" } }],
      evidence: evidence(),
    });

    expect(decision).toMatchObject({
      allowed: false,
      missing: [{ reason: "stale_context_generation" }],
    });
  });

  it("does not claim E3 when policy requires no documents", () => {
    expect(
      evaluateWriteContext({
        coordinates,
        requiredDocuments: [],
        evidence: [],
      }),
    ).toEqual({ allowed: true, assurance: null, missing: [] });
  });
});
