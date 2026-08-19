import { describe, expect, it } from "vitest";

import {
  RedactionError,
  sanitizeEventPayload,
} from "../src/index.js";

describe("event payload privacy boundary", () => {
  it("binds run completion to provider and verification result artifacts", () => {
    const completed = {
      resultDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      artifactIds: [
        "art_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
      verificationStatus: "passed",
    };
    expect(sanitizeEventPayload("run.completed", completed).payload).toEqual(completed);
    expect(() => sanitizeEventPayload("run.completed", {
      ...completed,
      artifactIds: completed.artifactIds.slice(1),
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));
    expect(() => sanitizeEventPayload("run.completed", {
      ...completed,
      verificationStatus: "not_run",
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));
  });

  it("removes separator, camelCase, and compatibility-form secret keys", () => {
    const result = sanitizeEventPayload("adapter.started", {
      adapterId: "lervo/codex",
      adapterVersion: "1",
      providerSessionId: "session-1",
      executionMode: "read_only",
      capabilities: {
        api_key: "secret-1",
        apiKey: "secret-2",
        rawPrompt: "secret-3",
        accessToken: "secret-4",
        secretToken: "secret-5",
        cookieValue: "secret-6",
        authorizationHeader: "secret-7",
        passwordHash: "secret-8",
        credentialValue: "secret-9",
        "ｐａｓｓｗｏｒｄ": "secret-10",
        toolCalls: "supported",
      },
    });

    expect(result.payload).toEqual({
      adapterId: "lervo/codex",
      adapterVersion: "1",
      providerSessionId: "session-1",
      executionMode: "read_only",
      capabilities: { toolCalls: "supported" },
    });
    expect(JSON.stringify(result.payload)).not.toContain("secret-");
    expect(result.redactions.filter((record) => record.reason === "sensitive_key")).toHaveLength(10);
  });

  it("rejects cyclic payloads instead of partially storing them", () => {
    const capabilities: Record<string, unknown> = { toolCalls: "supported" };
    capabilities.self = capabilities;

    expect(() =>
      sanitizeEventPayload("adapter.started", {
        adapterId: "lervo/codex",
        adapterVersion: "1",
        providerSessionId: "session-1",
        capabilities,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "cyclic_payload" }));
  });

  it("rejects non-finite numbers and class instances", () => {
    expect(() =>
      sanitizeEventPayload("tool.called", {
        toolName: "exec",
        durationMs: Number.NaN,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "non_finite_number" }));

    expect(() =>
      sanitizeEventPayload("adapter.started", {
        adapterId: "lervo/codex",
        adapterVersion: "1",
        providerSessionId: "session-1",
        capabilities: new Date(),
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "unsupported_value" }));
  });

  it("retains the normalized command status without retaining raw command text", () => {
    const result = sanitizeEventPayload("command.executed", {
      commandDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cwdRelative: ".",
      status: "completed",
      exitCode: 0,
      outputDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      durationMs: 15,
      command: "cat .env",
    });

    expect(result.payload).toEqual({
      commandDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cwdRelative: ".",
      status: "completed",
      exitCode: 0,
      outputDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      durationMs: 15,
    });
    expect(JSON.stringify(result.payload)).not.toContain("cat .env");
  });

  it("keeps E2 and E3 evidence receipt coordinates without document content", () => {
    const loaded = sanitizeEventPayload("document.loaded", {
      evidenceReceiptId: "ctx_loaded_00000001",
      documentId: "doc_context_00000001",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      byteCount: 42,
      scope: { mode: "full" },
      sourceRevision: "fixture-v1",
      documentBody: "private body",
    });
    const injected = sanitizeEventPayload("context.injected", {
      receiptId: "ctx_adapter_00000001",
      evidenceReceiptIds: ["ctx_injected_000001"],
      envelopeId: "env-context-1",
      documentIds: ["doc_context_00000001"],
      targetTurnId: "turn-context-1",
      contextGeneration: 0,
      rawContent: "private body",
    });

    expect(loaded.payload.evidenceReceiptId).toBe("ctx_loaded_00000001");
    expect(injected.payload.evidenceReceiptIds).toEqual(["ctx_injected_000001"]);
    expect(JSON.stringify([loaded.payload, injected.payload])).not.toContain("private body");
  });

  it("keeps migration hashes but removes reviewer and source path details", () => {
    const result = sanitizeEventPayload("document.migration.applied", {
      planId: "migp_aaaaaaaaaaaaaaaa",
      approvalId: "apr_migration_0001",
      approvalDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      beforeLayoutHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      afterLayoutHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      sourceHashes: ["sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      candidateArtifactHashes: [
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
      sidecars: [{
        documentId: "doc_readme_000001",
        contentHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      }],
      appliedAt: "2026-08-19T02:00:00Z",
      approverId: "private-reviewer",
      sourcePaths: ["README.md"],
      documentBody: "private body",
    });

    expect(result.payload).not.toHaveProperty("approverId");
    expect(result.payload).not.toHaveProperty("sourcePaths");
    expect(result.payload).not.toHaveProperty("documentBody");
    expect(result.payload).toHaveProperty("approvalDigest");
  });

  it("keeps structural migration coordinates without archive or source paths", () => {
    const result = sanitizeEventPayload("document.migration.applied", {
      migrationKind: "legacy_registry_structural",
      planId: "migp_aaaaaaaaaaaaaaaa",
      approvalId: "apr_legacy_000001",
      approvalDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRegistryHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      entryArtifactHashes: [
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
      archiveContentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      beforeLayoutHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      afterLayoutHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      sidecars: [],
      appliedAt: "2026-08-19T05:00:00Z",
      archivePath: ".lervo/archive/private.yaml",
      sourcePath: ".lervo/documents.yaml",
      approverId: "private-reviewer",
    });

    expect(result.payload).toMatchObject({
      migrationKind: "legacy_registry_structural",
      sourceRegistryHash:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(result.payload).not.toHaveProperty("archivePath");
    expect(result.payload).not.toHaveProperty("sourcePath");
    expect(result.payload).not.toHaveProperty("approverId");
  });

  it("keeps deliberation coordinates without artifact bodies or provider diagnostics", () => {
    const result = sanitizeEventPayload("deliberation.artifact.recorded", {
      deliberationId: "dlb_architecture_0001",
      deliberationArtifactId: "dla_0123456789abcdef",
      kind: "verification",
      round: 2,
      producerRoleId: "verifier",
      artifactId: "art_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      writingPermitId: "wpp_0123456789abcdef",
      rawContent: "private deliberation body",
      providerResponse: "private provider response",
      diagnostic: "private diagnostic",
    });

    expect(result.payload).toEqual({
      deliberationId: "dlb_architecture_0001",
      deliberationArtifactId: "dla_0123456789abcdef",
      kind: "verification",
      round: 2,
      producerRoleId: "verifier",
      artifactId: "art_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      writingPermitId: "wpp_0123456789abcdef",
    });
    expect(JSON.stringify(result.payload)).not.toContain("private");
  });

  it("rejects incomplete or status-inconsistent deliberation payloads", () => {
    expect(() => sanitizeEventPayload("deliberation.started", {
      deliberationId: "dlb_architecture_0001",
      policyId: "deliberation_architecture-review",
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));

    expect(() => sanitizeEventPayload("deliberation.completed", {
      deliberationId: "dlb_architecture_0001",
      outcomeId: "dlo_0123456789abcdef",
      status: "converged",
      lastRound: 2,
      decisionArtifactId: null,
      unresolvedBlockingObjectionIds: [],
      failurePhase: null,
      failureCode: null,
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));

    expect(() => sanitizeEventPayload("deliberation.artifact.recorded", {
      deliberationId: "dlb_architecture_0001",
      deliberationArtifactId: "dla_0123456789abcdef",
      kind: "proposal",
      round: 1,
      producerRoleId: "architect",
      artifactId: "art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      writingPermitId: "wpp_0123456789abcdef",
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));
  });

  it("accepts a complete failed deliberation payload without raw diagnostics", () => {
    const result = sanitizeEventPayload("deliberation.completed", {
      deliberationId: "dlb_architecture_0001",
      outcomeId: "dlo_0123456789abcdef",
      status: "failed",
      lastRound: 2,
      decisionArtifactId: null,
      unresolvedBlockingObjectionIds: ["obj_architecture_0001"],
      failurePhase: "verification",
      failureCode: "result_contract_invalid",
      diagnostic: "private stack",
    });

    expect(result.payload).toEqual({
      deliberationId: "dlb_architecture_0001",
      outcomeId: "dlo_0123456789abcdef",
      status: "failed",
      lastRound: 2,
      decisionArtifactId: null,
      unresolvedBlockingObjectionIds: ["obj_architecture_0001"],
      failurePhase: "verification",
      failureCode: "result_contract_invalid",
    });
  });

  it("keeps knowledge evidence coordinates without claim or decision bodies", () => {
    const result = sanitizeEventPayload("knowledge.candidate.created", {
      candidateId: "knc_0123456789abcdef",
      claimDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      paths: ["src/decision.ts"],
      evidenceIds: ["evt_knowledge_0001"],
      sourceOutcomeId: "dlo_0123456789abcdef",
      decisionArtifactId: "dla_0123456789abcdef",
      verificationArtifactIds: ["dla_1111111111111111"],
      verifiedRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      candidateArtifactId: "art_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      candidateContentHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      rawContent: "private knowledge body",
      providerResponse: "private provider response",
    });

    expect(result.payload.candidateId).toBe("knc_0123456789abcdef");
    expect(JSON.stringify(result.payload)).not.toContain("private");
    expect(() => sanitizeEventPayload("knowledge.candidate.created", {
      ...result.payload,
      candidateArtifactId: "art_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));
  });

  it("keeps review, verified, and stale coordinates without reviewer identity", () => {
    const review = sanitizeEventPayload("knowledge.candidate.reviewed", {
      candidateId: "knc_0123456789abcdef",
      candidateContentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      approvalId: "knr_0123456789abcdef",
      approvalArtifactId: "art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      approvalContentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      decision: "approved",
      policyId: "knowledge_human-review",
      policyVersion: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      repositoryRevision: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      resolvedConflictCandidateIds: [],
      reviewerId: "private@example.com",
    });
    expect(JSON.stringify(review.payload)).not.toContain("private@example.com");

    expect(() => sanitizeEventPayload("knowledge.verified", {
      knowledgeId: "knw_0123456789abcdef",
      candidateId: "knc_0123456789abcdef",
      candidateContentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      approvalId: "knr_0123456789abcdef",
      approvalContentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      claimDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      paths: ["src/decision.ts"],
      verifiedRevision: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      knowledgeArtifactId: "art_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      knowledgeContentHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));
  });

  it("keeps verification result coordinates without commands or output", () => {
    const started = sanitizeEventPayload("verification.started", {
      suiteId: "project.default",
      suiteHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repositoryRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      command: "private command",
    });
    expect(started.payload).not.toHaveProperty("command");

    const completed = {
      verificationId: "ver_0123456789abcdef",
      suiteId: "project.default",
      suiteHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repositoryRevision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      status: "passed",
      resultArtifactId: "art_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      resultContentHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      nonPassedCommandIds: [],
      rawOutput: "private output",
    };
    expect(JSON.stringify(sanitizeEventPayload("verification.completed", completed).payload))
      .not.toContain("private output");
    expect(() => sanitizeEventPayload("verification.completed", {
      ...completed,
      resultArtifactId: "art_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    })).toThrowError(expect.objectContaining<Partial<RedactionError>>({
      code: "invalid_payload",
    }));
  });
});
