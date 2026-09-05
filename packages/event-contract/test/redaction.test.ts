import { describe, expect, it } from "vitest";

import { RedactionError, sanitizeEventPayload } from "../src/index.js";

describe("event payload privacy boundary", () => {
  it("retains the bounded replacement coordinate for pattern supersession", () => {
    const payload = {
      transitionId: `dptr_${"a".repeat(24)}`,
      patternId: `pattern_${"b".repeat(24)}`,
      fromState: "reviewed",
      toState: "superseded",
      candidateArtifactId: `art_${"c".repeat(64)}`,
      candidateContentHash: `sha256:${"c".repeat(64)}`,
      reviewArtifactId: `art_${"d".repeat(64)}`,
      reviewContentHash: `sha256:${"d".repeat(64)}`,
      supersededByPatternId: `pattern_${"e".repeat(24)}`,
      targetKind: "portable_skill",
      approvalHash: `sha256:${"f".repeat(64)}`,
      occurredAt: "2026-09-05T00:00:00.000Z",
    };

    expect(sanitizeEventPayload("development.pattern.transitioned", payload)).toEqual({
      payload,
      redactions: [],
    });
  });

  it("keeps bounded effect coordinates while excluding adapter-private evidence", () => {
    const payload = {
      comparisonId: `iecomparison_${"a".repeat(24)}`,
      patternId: `pattern_${"b".repeat(24)}`,
      protocolId: `ieprotocol_${"c".repeat(24)}`,
      comparisonPlanId: `ieplan_${"d".repeat(24)}`,
      comparisonArtifactId: `art_${"e".repeat(64)}`,
      comparisonArtifactHash: `sha256:${"e".repeat(64)}`,
      registrationEventId: `evt_${"f".repeat(32)}`,
      promotionEventId: `evt_${"1".repeat(32)}`,
      targetContentHash: `sha256:${"2".repeat(64)}`,
      adapterId: "iobs_repository_metrics",
      adapterVersion: "1.0.0",
      adapterDescriptorHash: `sha256:${"3".repeat(64)}`,
      treatmentWindowHash: `sha256:${"4".repeat(64)}`,
      treatmentObservationHash: `sha256:${"5".repeat(64)}`,
      overall: "mixed_or_unfavorable_observation",
      attribution: "unestablished",
      rollbackDisposition: "review_required",
      metricCount: 2,
      observedAt: "2026-09-02T00:00:00.000Z",
    };
    expect(
      sanitizeEventPayload("development.pattern.effect.observed", {
        ...payload,
        rawEvidence: "private provider-native evidence",
      }),
    ).toMatchObject({ payload, redactions: [{ path: "$.rawEvidence" }] });
  });

  it("keeps bounded foundation observations and rejects contradictory resource counters", () => {
    const payload = {
      workId: `wrk_${"a".repeat(24)}`,
      resourceObservationId: `ruo_${"b".repeat(24)}`,
      sourceCoordinateDigest: `sha256:${"c".repeat(64)}`,
      scope: "primary_provider",
      source: "provider_reported",
      accountingMode: "turn_cumulative",
      accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
      status: "observed",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 10,
        reasoningOutputTokens: 5,
        totalTokens: 110,
        contextWindow: null,
      },
      reasonCode: null,
    };
    expect(
      sanitizeEventPayload("resource.usage.recorded", {
        ...payload,
        providerResponse: "private native response",
      }),
    ).toMatchObject({ payload, redactions: [{ path: "$.providerResponse" }] });
    expect(() =>
      sanitizeEventPayload("resource.usage.recorded", {
        ...payload,
        usage: { ...payload.usage, totalTokens: 111 },
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
  });

  it("keeps exact activation evidence while excluding provider configuration and credentials", () => {
    const payload = {
      capabilityId: "research/search",
      capabilityKind: "mcp_server",
      version: "1.0.0",
      contentHash: `sha256:${"a".repeat(64)}`,
      adapterId: "lervo/codex",
      providerSessionId: "thread-1",
      evidence: "mcp_connected",
      activationDigest: `sha256:${"b".repeat(64)}`,
    };
    const result = sanitizeEventPayload("capability.activated", {
      ...payload,
      command: "private command",
      url: "https://private.example/",
      credentialNames: ["PRIVATE_TOKEN"],
      credentialValue: "private secret",
    });
    expect(result.payload).toEqual(payload);
    expect(JSON.stringify(result.payload)).not.toContain("private");
    expect(result.redactions).toEqual(
      expect.arrayContaining([
        { path: "$.command", reason: "not_allowlisted" },
        { path: "$.url", reason: "not_allowlisted" },
        { path: "$.credentialNames", reason: "not_allowlisted" },
        { path: "$.credentialValue", reason: "not_allowlisted" },
      ]),
    );
  });

  it("keeps versioned role bindings while excluding role source and profile content", () => {
    const payload = {
      agentId: `agt_${"a".repeat(24)}`,
      roleId: "legal-researcher",
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${"b".repeat(64)}`,
      roleProfileHash: `sha256:${"c".repeat(64)}`,
      capabilityHash: `sha256:${"d".repeat(64)}`,
      provider: "any",
      parentAgentId: null,
      delegationDepth: 0,
    };
    const result = sanitizeEventPayload("agent.registered", {
      ...payload,
      sourcePath: ".lervo/roles/legal-researcher.json",
      description: "private role prose",
    });
    expect(result.payload).toEqual(payload);
    expect(JSON.stringify(result.payload)).not.toContain("private");
    expect(JSON.stringify(result.payload)).not.toContain(".lervo/roles");
  });

  it("keeps bounded routine provenance while excluding template and trigger bodies", () => {
    const payload = {
      assignmentId: `asn_${"a".repeat(24)}`,
      taskType: "implementation",
      roleId: "developer",
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${"b".repeat(64)}`,
      requiredCapabilityHash: `sha256:${"c".repeat(64)}`,
      routineId: "change.review",
      routineTemplateVersion: "1.0.0",
      routineTemplateHash: `sha256:${"d".repeat(64)}`,
      routineInvocationId: `rin_${"e".repeat(24)}`,
      routineTriggerKind: "manual",
      routineTriggerDigest: `sha256:${"f".repeat(64)}`,
      routineNodeKey: "implement",
      priority: 50,
      dependencyIds: [],
      expectedPathDigest: `sha256:${"1".repeat(64)}`,
      acceptanceDigest: `sha256:${"2".repeat(64)}`,
      verificationDigest: `sha256:${"3".repeat(64)}`,
      approvalDigest: `sha256:${"4".repeat(64)}`,
      workstreamId: `wks_${"5".repeat(24)}`,
    };
    const result = sanitizeEventPayload("assignment.created", {
      ...payload,
      acceptanceCriteria: ["private acceptance"],
      expectedPaths: ["private/path.ts"],
      triggerRequest: "private trigger",
      idempotencyKey: "private key",
    });
    expect(result.payload).toEqual(payload);
    expect(JSON.stringify(result.payload)).not.toContain("private");
  });

  it("keeps immutable terminal observations valid across additive coordinate revisions", () => {
    const prepared = {
      observationId: "tobs_context_01234567",
      executionMode: "unmanaged",
      providerSessionDigest: `sha256:${"a".repeat(64)}`,
      providerTurnDigest: null,
      sourceSnapshotId: `ksnap_${"b".repeat(24)}`,
      queryDigest: `sha256:${"c".repeat(64)}`,
      contextHash: `sha256:${"d".repeat(64)}`,
      recommendationCount: 0,
      loadedDocuments: [],
    };
    const observed = {
      observationId: "tobs_turn_0123456789",
      contextEventId: "evt_context_01234567",
      referenceEventIds: [],
      referenceCount: 0,
      referenceTelemetry: "unavailable",
      lifecycleStatus: "current",
      completionResult: "allowed",
      providerSessionDigest: `sha256:${"e".repeat(64)}`,
      providerTurnDigest: null,
    };

    expect(sanitizeEventPayload("terminal.context.prepared", prepared).payload).toEqual(prepared);
    const withDurableInstruction = {
      ...prepared,
      durableInstructionStatus: "ignored",
      durableInstructionRuleId: null,
      durableInstructionTargetPath: null,
      durableInstructionReasonIds: ["semantic_resolution_failed"],
    };
    expect(
      sanitizeEventPayload("terminal.context.prepared", {
        ...withDurableInstruction,
        normalizedRuleText: "private normalized rule",
      }).payload,
    ).toEqual(withDurableInstruction);
    const historicalGrounded = {
      ...prepared,
      requestDigest: `sha256:${"2".repeat(64)}`,
      groundingStatus: "abstain",
      groundingWorkflowId: null,
      groundingSourceClasses: [],
      groundingSubjectIds: [],
      groundingProviderIds: [],
      groundingReasons: ["semantic_resolution_failed"],
      selectionStatus: "not_selected",
      loadingStatus: "not_run",
      hookPreparationStatus: "observed",
      providerInjectionStatus: "unobserved",
      providerUseStatus: "unknown",
    };
    expect(sanitizeEventPayload("terminal.context.prepared", historicalGrounded).payload).toEqual(
      historicalGrounded,
    );
    const currentPrepared = {
      ...withDurableInstruction,
      repositoryRevision: `sha256:${"1".repeat(64)}`,
      requestDigest: `sha256:${"2".repeat(64)}`,
      queryProjectionReceipt: {
        schemaVersion: 1,
        receiptId: `sqproj_${"3".repeat(24)}`,
        stageId: "query_projection",
        projector: {
          id: "provider_query_projection.codex",
          version: 1,
          buildId: `sqbuild_${"4".repeat(24)}`,
        },
        requestDigest: `sha256:${"2".repeat(64)}`,
        contextDigest: `sha256:${"5".repeat(64)}`,
        projectorResultDigest: `sha256:${"6".repeat(64)}`,
        requestedLanguage: "en",
        limits: { maximumQueries: 8, maximumQueryCharacters: 500 },
        projectedQueryCount: 1,
        projectedQueryDigest: `sha256:${"7".repeat(64)}`,
        durationMs: 100,
        status: "completed",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 10,
          reasoningOutputTokens: 5,
          totalTokens: 110,
          contextWindow: 258_400,
        },
        privacy: {
          requestText: "excluded",
          contextText: "excluded",
          projectedQueryText: "excluded",
        },
      },
      groundingStatus: "abstain",
      groundingWorkflowId: null,
      groundingSourceClasses: [],
      groundingSubjectIds: [],
      groundingProviderIds: [],
      groundingReasons: ["semantic_resolution_failed"],
      selectionStatus: "selected",
      loadingStatus: "observed",
      hookPreparationStatus: "observed",
      providerInjectionStatus: "unobserved",
      providerUseStatus: "unknown",
      workstreamId: null,
      workstreamRevision: null,
      workstreamSnapshotHash: null,
      workstreamScope: null,
      workstreamDeliveredByteCount: null,
      workspaceExecutionKind: null,
      workspaceId: null,
      workspaceGeneration: null,
      workspaceRevision: null,
      assignmentId: null,
      leaseGeneration: null,
      writerSessionId: null,
    };
    const sanitizedCurrent = sanitizeEventPayload("terminal.context.prepared", {
      ...currentPrepared,
      queryProjectionReceipt: {
        ...currentPrepared.queryProjectionReceipt,
        usage: {
          ...currentPrepared.queryProjectionReceipt.usage,
          accessToken: "private credential",
        },
      },
    });
    expect(sanitizedCurrent.payload).toEqual(currentPrepared);
    expect(sanitizedCurrent.redactions).toContainEqual({
      path: "$.queryProjectionReceipt.usage.accessToken",
      reason: "sensitive_key",
    });
    expect(sanitizeEventPayload("terminal.turn.observed", observed).payload).toEqual(observed);
    expect(() =>
      sanitizeEventPayload("terminal.context.prepared", {
        ...prepared,
        workstreamId: null,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
    expect(() =>
      sanitizeEventPayload("terminal.context.prepared", {
        ...prepared,
        durableInstructionStatus: "ignored",
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
    expect(() =>
      sanitizeEventPayload("terminal.context.prepared", {
        ...prepared,
        queryProjectionReceipt: currentPrepared.queryProjectionReceipt,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
    expect(() =>
      sanitizeEventPayload("terminal.turn.observed", {
        ...observed,
        repositoryChanged: false,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
  });

  it("keeps bounded unmanaged coordinates while excluding provider text", () => {
    const result = sanitizeEventPayload("terminal.context.prepared", {
      observationId: "tobs_context_01234567",
      executionMode: "unmanaged",
      providerSessionDigest: `sha256:${"a".repeat(64)}`,
      providerTurnDigest: null,
      sourceSnapshotId: `ksnap_${"b".repeat(24)}`,
      repositoryRevision: `sha256:${"9".repeat(64)}`,
      queryDigest: `sha256:${"c".repeat(64)}`,
      contextHash: `sha256:${"d".repeat(64)}`,
      recommendationCount: 1,
      loadedDocuments: [
        {
          conceptId: `concept_${"e".repeat(24)}`,
          path: "docs/knowledge/cache.md",
          contentHash: `sha256:${"f".repeat(64)}`,
          scope: "full",
          deliveredByteCount: 42,
          assurance: "human_reviewed",
          freshness: "current",
        },
      ],
      workstreamId: null,
      workstreamRevision: null,
      workstreamSnapshotHash: null,
      workstreamScope: null,
      workstreamDeliveredByteCount: null,
      prompt: "private prompt text",
      lastAssistantMessage: "private completion text",
      providerSessionId: "private-provider-session",
    });
    expect(result.payload).toMatchObject({ executionMode: "unmanaged", recommendationCount: 1 });
    expect(JSON.stringify(result.payload)).not.toContain("private");
    expect(result.redactions).toEqual(
      expect.arrayContaining([
        { path: "$.prompt", reason: "not_allowlisted" },
        { path: "$.lastAssistantMessage", reason: "not_allowlisted" },
        { path: "$.providerSessionId", reason: "not_allowlisted" },
      ]),
    );
  });

  it("stores only content-addressed workstream coordinates", () => {
    const snapshotHash = `sha256:${"a".repeat(64)}`;
    const sourceHash = `sha256:${"b".repeat(64)}`;
    const payload = {
      workstreamId: `wks_${"c".repeat(24)}`,
      revision: 1,
      status: "active",
      changeKind: "legacy_handoff_migration",
      snapshotArtifactId: `art_${"a".repeat(64)}`,
      snapshotContentHash: snapshotHash,
      previousSnapshotContentHash: null,
      sourceArtifactId: `art_${"b".repeat(64)}`,
      sourceContentHash: sourceHash,
      recordedAt: "2026-08-24T00:00:00.000Z",
    };
    expect(
      sanitizeEventPayload("workstream.snapshot.recorded", {
        ...payload,
        objective: "private objective",
      }).payload,
    ).toEqual(payload);
    expect(() =>
      sanitizeEventPayload("workstream.snapshot.recorded", {
        ...payload,
        snapshotArtifactId: `art_${"d".repeat(64)}`,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
  });

  it("keeps only bounded agent-declared terminal disposition coordinates", () => {
    const payload = {
      declarationId: "tdecl_0123456789abcdef",
      contextEventId: "evt_context_01234567",
      repositoryRevision: `sha256:${"a".repeat(64)}`,
      taskMode: "change",
      canonicalizationDisposition: "canonical_sources_updated",
      knowledgeDisposition: "refreshed",
      deliberationDisposition: "not_requested",
      deliberationId: null,
      declaredAt: "2026-08-24T00:00:00.000Z",
    };
    const result = sanitizeEventPayload("terminal.turn.declared", {
      ...payload,
      summary: "private provider prose",
    });
    expect(result.payload).toEqual(payload);
    expect(JSON.stringify(result.payload)).not.toContain("private");
  });

  it("keeps repository reconciliation review coordinates without reviewer identity", () => {
    const hash = `sha256:${"a".repeat(64)}`;
    const payload = {
      compilationId: `kcomp_${"b".repeat(24)}`,
      candidateArtifactHash: `sha256:${"c".repeat(64)}`,
      reconciliationPlanId: `krecon_${"d".repeat(24)}`,
      sourceSnapshotId: `ksnap_${"e".repeat(24)}`,
      registryDigest: `sha256:${"f".repeat(64)}`,
      reviewId: `krvw_${"1".repeat(24)}`,
      reviewArtifactId: `art_${"a".repeat(64)}`,
      reviewArtifactHash: hash,
      decision: "approved",
      policyId: "knowledge_semantic_review.default",
      policyVersion: `sha256:${"2".repeat(64)}`,
      itemApprovalDigest: `sha256:${"5".repeat(64)}`,
      acceptedDispositionIds: [`kdisp_${"3".repeat(24)}`],
      skippedDispositionIds: [`kdisp_${"4".repeat(24)}`],
      dispositionListTruncated: false,
      dispositionCount: 2,
      reviewedAt: "2026-08-22T00:00:00.000Z",
    };
    const result = sanitizeEventPayload("knowledge.reconciliation.reviewed", {
      ...payload,
      reviewerId: "private.human",
      prompt: "private",
    });
    expect(result.payload).toEqual(payload);
    expect(result.payload).not.toHaveProperty("reviewerId");
    expect(() =>
      sanitizeEventPayload("knowledge.reconciliation.reviewed", {
        ...payload,
        reviewArtifactId: `art_${"9".repeat(64)}`,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
  });

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
    expect(() =>
      sanitizeEventPayload("run.completed", {
        ...completed,
        artifactIds: completed.artifactIds.slice(1),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );
    expect(() =>
      sanitizeEventPayload("run.completed", {
        ...completed,
        verificationStatus: "not_run",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );
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
        ｐａｓｓｗｏｒｄ: "secret-10",
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
    expect(result.redactions.filter((record) => record.reason === "sensitive_key")).toHaveLength(
      10,
    );
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
    const knowledgeContext = {
      conceptId: `concept_${"1".repeat(24)}`,
      assurance: "human_reviewed",
      freshness: "current",
      sourceSnapshotId: `ksnap_${"2".repeat(24)}`,
      impactReportId: `kimpact_${"3".repeat(24)}`,
    };
    const loaded = sanitizeEventPayload("document.loaded", {
      evidenceReceiptId: "ctx_loaded_00000001",
      documentId: "doc_context_00000001",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      byteCount: 42,
      scope: { mode: "full" },
      sourceRevision: "fixture-v1",
      knowledgeContext,
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
    expect(loaded.payload.knowledgeContext).toEqual(knowledgeContext);
    expect(injected.payload.evidenceReceiptIds).toEqual(["ctx_injected_000001"]);
    expect(JSON.stringify([loaded.payload, injected.payload])).not.toContain("private body");
  });

  it("keeps managed E4 bindings without provider result or document bodies", () => {
    const contentHash = `sha256:${"a".repeat(64)}`;
    const result = sanitizeEventPayload("adapter.result.captured", {
      adapterId: "lervo/codex",
      providerSessionId: "provider-session-1",
      targetTurnId: "target-turn-1",
      providerTurnId: "provider-turn-1",
      resultDigest: `sha256:${"b".repeat(64)}`,
      byteCount: 42,
      mediaType: "text/markdown; charset=utf-8",
      referenceTelemetry: "supported",
      content: "private provider response",
    });
    const reference = sanitizeEventPayload("context.referenced", {
      evidenceReceiptId: "ctx_reference_0000001",
      injectedEvidenceReceiptId: "ctx_injected_00000001",
      adapterReceiptId: "ctx_adapter_00000001",
      sourceEventId: "evt_result_00000001",
      documentId: "doc_context_00000001",
      contentHash,
      scope: { kind: "full" },
      provider: "codex",
      providerSessionId: "provider-session-1",
      targetTurnId: "target-turn-1",
      providerTurnId: "provider-turn-1",
      contextGeneration: 0,
      referenceKind: "output_citation",
      citation: `lervo-e4:doc_context_00000001:${contentHash}`,
      documentBody: "private document body",
    });

    expect(result.payload).not.toHaveProperty("content");
    expect(reference.payload).not.toHaveProperty("documentBody");
    expect(reference.payload).toMatchObject({
      documentId: "doc_context_00000001",
      contentHash,
      referenceKind: "output_citation",
    });
    expect(JSON.stringify([result.payload, reference.payload])).not.toContain("private");
  });

  it("keeps bounded search recommendation evidence without query or source path", () => {
    const recommendation = {
      recommendationId: "srec_aaaaaaaaaaaaaaaaaaaaaaaa",
      batchId: "srb_bbbbbbbbbbbbbbbbbbbbbbbb",
      sourceAttemptId: "sat_cccccccccccccccccccccccc",
      engineId: "lexical",
      engineVersion: 2,
      selectionTransitionId: null,
      productQualificationId: "spqual_aaaaaaaaaaaaaaaaaaaaaaaa",
      indexId: "sidx_dddddddddddddddddddddddd",
      resultSetHash: `sha256:${"e".repeat(64)}`,
      documentId: "doc_context_00000001",
      sourceContentHash: `sha256:${"f".repeat(64)}`,
      rank: 1,
      score: 12,
      selectionPolicyId: "top_ranked",
      selectionPolicyVersion: 1,
      selectionMaximum: 3,
      knowledgeContext: {
        conceptId: `concept_${"1".repeat(24)}`,
        assurance: "unreviewed",
        freshness: "unknown",
        sourceSnapshotId: `ksnap_${"2".repeat(24)}`,
        impactReportId: `kimpact_${"3".repeat(24)}`,
      },
    };
    const result = sanitizeEventPayload("context.recommended", {
      ...recommendation,
      rawQuery: "private query",
      sourcePath: "private/path.md",
    });

    expect(result.payload).toEqual(recommendation);
    expect(JSON.stringify(result.payload)).not.toContain("private");
    const { sourceAttemptId: _missing, ...incomplete } = recommendation;
    expect(() => sanitizeEventPayload("context.recommended", incomplete)).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }),
    );
    const { selectionTransitionId: _legacyMissing, ...legacyRecommendation } = recommendation;
    expect(sanitizeEventPayload("context.recommended", legacyRecommendation).payload).toEqual(
      legacyRecommendation,
    );
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
      sidecars: [
        {
          documentId: "doc_readme_000001",
          contentHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
      ],
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
      sourceRegistryHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(result.payload).not.toHaveProperty("archivePath");
    expect(result.payload).not.toHaveProperty("sourcePath");
    expect(result.payload).not.toHaveProperty("approverId");
  });

  it("keeps identity migration proof without repository or document details", () => {
    const result = sanitizeEventPayload("project.identity.migrated", {
      planId: "idm_0123456789abcdef0123456789abcdef",
      sourceTreeHash: `sha256:${"a".repeat(64)}`,
      preservedEventCount: 12,
      preservedEventHeadHash: `sha256:${"b".repeat(64)}`,
      verifiedCasObjectCount: 4,
      documentDisposition: "archive_previous_metadata",
      migratedAt: "2026-08-22T05:00:00Z",
      repositoryRoot: "/private/project",
      documentPaths: ["README.md"],
      documentBody: "private body",
    });

    expect(result.payload).toEqual({
      planId: "idm_0123456789abcdef0123456789abcdef",
      sourceTreeHash: `sha256:${"a".repeat(64)}`,
      preservedEventCount: 12,
      preservedEventHeadHash: `sha256:${"b".repeat(64)}`,
      verifiedCasObjectCount: 4,
      documentDisposition: "archive_previous_metadata",
      migratedAt: "2026-08-22T05:00:00Z",
    });
    expect(() =>
      sanitizeEventPayload("project.identity.migrated", {
        ...result.payload,
        preservedEventHeadHash: null,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
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
    expect(() =>
      sanitizeEventPayload("deliberation.started", {
        deliberationId: "dlb_architecture_0001",
        policyId: "deliberation_architecture-review",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );

    expect(() =>
      sanitizeEventPayload("deliberation.completed", {
        deliberationId: "dlb_architecture_0001",
        outcomeId: "dlo_0123456789abcdef",
        status: "converged",
        lastRound: 2,
        decisionArtifactId: null,
        unresolvedBlockingObjectionIds: [],
        failurePhase: null,
        failureCode: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );

    expect(() =>
      sanitizeEventPayload("deliberation.artifact.recorded", {
        deliberationId: "dlb_architecture_0001",
        deliberationArtifactId: "dla_0123456789abcdef",
        kind: "proposal",
        round: 1,
        producerRoleId: "architect",
        artifactId: "art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        writingPermitId: "wpp_0123456789abcdef",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );
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
      candidateContentHash:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      rawContent: "private knowledge body",
      providerResponse: "private provider response",
    });

    expect(result.payload.candidateId).toBe("knc_0123456789abcdef");
    expect(JSON.stringify(result.payload)).not.toContain("private");
    expect(() =>
      sanitizeEventPayload("knowledge.candidate.created", {
        ...result.payload,
        candidateArtifactId: "art_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );
  });

  it("keeps review, verified, and stale coordinates without reviewer identity", () => {
    const review = sanitizeEventPayload("knowledge.candidate.reviewed", {
      candidateId: "knc_0123456789abcdef",
      candidateContentHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      approvalId: "knr_0123456789abcdef",
      approvalArtifactId: "art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      approvalContentHash:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      decision: "approved",
      policyId: "knowledge_human-review",
      policyVersion: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      repositoryRevision: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      resolvedConflictCandidateIds: [],
      reviewerId: "private@example.com",
    });
    expect(JSON.stringify(review.payload)).not.toContain("private@example.com");

    expect(() =>
      sanitizeEventPayload("knowledge.verified", {
        knowledgeId: "knw_0123456789abcdef",
        candidateId: "knc_0123456789abcdef",
        candidateContentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        approvalId: "knr_0123456789abcdef",
        approvalContentHash:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        claimDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        paths: ["src/decision.ts"],
        verifiedRevision: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        knowledgeArtifactId: "art_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        knowledgeContentHash:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );
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
    expect(
      JSON.stringify(sanitizeEventPayload("verification.completed", completed).payload),
    ).not.toContain("private output");
    expect(() =>
      sanitizeEventPayload("verification.completed", {
        ...completed,
        resultArtifactId: "art_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RedactionError>>({
        code: "invalid_payload",
      }),
    );
  });

  it("keeps only exact prepared completion coordinates", () => {
    const payload = {
      completionEvidenceId: `acp_${"a".repeat(24)}`,
      workstreamId: `wks_${"b".repeat(24)}`,
      assignmentId: `asn_${"c".repeat(24)}`,
      assignmentRevision: 2,
      agentId: `agt_${"d".repeat(24)}`,
      leaseId: `lse_${"e".repeat(24)}`,
      resultArtifactId: `art_${"f".repeat(64)}`,
      resultContentHash: `sha256:${"f".repeat(64)}`,
      verificationStatus: "passed",
      writingPublicationStatus: "allowed",
      preparedAt: "2026-09-01T00:00:00.000Z",
    };
    expect(
      sanitizeEventPayload("assignment.completion.prepared", {
        ...payload,
        task: "private task",
        providerOutput: "private output",
      }),
    ).toMatchObject({ payload });
    expect(() =>
      sanitizeEventPayload("assignment.completion.prepared", {
        ...payload,
        resultArtifactId: `art_${"1".repeat(64)}`,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "invalid_payload" }));
    const reconciled = {
      completionEvidenceId: payload.completionEvidenceId,
      reconciliationCommandId: `gcr_${"1".repeat(24)}`,
      sourceRunId: "run_completion_fixture",
      assignmentId: payload.assignmentId,
      agentId: payload.agentId,
      leaseId: payload.leaseId,
      resultArtifactId: payload.resultArtifactId,
      resultContentHash: payload.resultContentHash,
      revision: 3,
      reconciledAt: "2026-09-01T00:01:00.000Z",
    };
    expect(
      sanitizeEventPayload("assignment.completion.reconciled", {
        ...reconciled,
        task: "private task",
      }),
    ).toMatchObject({ payload: reconciled });
  });
});
