import { describe, expect, it } from "vitest";

import { validateSchema } from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_compatibility_01",
    projectId: "prj_compatibility_01",
    runId: "run_compatibility_01",
    sessionId: "ses_compatibility_01",
    seq: 1,
    type: "run.requested",
    occurredAt: "2026-09-01T00:00:00.000Z",
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion: hash,
    payload: {},
    previousHash: null,
    eventHash: hash,
    ...overrides,
  };
}

describe("reader-first event envelope compatibility", () => {
  it("accepts supported envelopes while rejecting an unsupported version", () => {
    expect(validateSchema("event", envelope()).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 2 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 3 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 4 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 5 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 6 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 7 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 8 })).valid).toBe(true);
    expect(validateSchema("event", envelope({ schemaVersion: 12 })).valid).toBe(false);
  });

  it("reserves maintenance receipts for schema 5 and enforces hash-only payloads", () => {
    for (const schemaVersion of [1, 2, 3, 4, 5])
      expect(
        validateSchema(
          "event",
          envelope({ schemaVersion, type: "document.freshness.assessment.recorded" }),
        ).valid,
      ).toBe(schemaVersion === 5);
    const payload = {
      projectId: "prj_compatibility_01",
      findingDigest: hash,
      documentHash: hash,
      evidenceContractHash: hash,
      receiptHash: hash,
      occurredAt: "2026-10-08T01:00:00Z",
      outcome: "verified_no_change",
      dependencyDigest: hash,
      verificationContractHash: hash,
    };
    expect(validateSchema("documentFreshnessAssessmentRecordedEventPayload", payload).valid).toBe(
      true,
    );
    expect(
      validateSchema("documentFreshnessAssessmentRecordedEventPayload", {
        ...payload,
        sourceText: "private source",
      }).valid,
    ).toBe(false);
  });

  it("reserves supervision event types for v3 envelopes", () => {
    for (const schemaVersion of [1, 2, 3]) {
      expect(
        validateSchema(
          "event",
          envelope({
            schemaVersion,
            type: "work.supervision.decision.recorded",
          }),
        ).valid,
      ).toBe(schemaVersion === 3);
    }
  });

  it("keeps foundation event types unavailable to v1 envelopes", () => {
    const causality = {
      workId: `wrk_${"b".repeat(24)}`,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    };
    expect(
      validateSchema(
        "event",
        envelope({ schemaVersion: 2, type: "work.causality.recorded", payload: causality }),
      ).valid,
    ).toBe(true);
    expect(
      validateSchema(
        "event",
        envelope({ schemaVersion: 1, type: "work.causality.recorded", payload: causality }),
      ).valid,
    ).toBe(false);
  });

  it("keeps root-agent liveness events unavailable to v1 envelopes", () => {
    const payload = {
      agentId: `agt_${"b".repeat(24)}`,
      agentRevision: 3,
      reportingProvider: "codex",
      providerSessionDigest: hash,
      observedAt: "2026-09-05T00:00:00.000Z",
    };
    expect(validateSchema("agentLivenessObservedEventPayload", payload).valid).toBe(true);
    expect(
      validateSchema("agentLivenessObservedEventPayload", {
        ...payload,
        reportingProvider: "unmanaged-provider",
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 2, type: "agent.liveness.observed" }),
        payload,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 1, type: "agent.liveness.observed" }),
        payload,
      }).valid,
    ).toBe(false);
  });

  it("keeps managed conversation repository-work completion unavailable to v1", () => {
    const payload = {
      sourceConversationEventId: `cve_${"b".repeat(64)}`,
      workerAgentId: `agt_${"c".repeat(24)}`,
      providerSessionDigest: hash,
      requestedModel: "gpt-6-astra",
      requestedReasoningEffort: "medium",
      executionProfile: "routine",
      allocationReason: "profile_preference",
      requestContentHash: hash,
      resultContentHash: hash,
      resultByteCount: 42,
      repositoryRevisionBefore: `sha256:${"d".repeat(64)}`,
      repositoryRevisionAfter: `sha256:${"e".repeat(64)}`,
      changedPaths: ["src/incomplete.ts"],
      changedPathCount: 1,
      workstreamId: `wks_${"f".repeat(24)}`,
      workstreamRevision: 7,
      workstreamSnapshotHash: hash,
      knowledgeDisposition: "current",
      checkpointDisposition: "host_checkpoint",
      replicaDisposition: "current",
      verificationStatus: "passed",
      completedAt: "2026-09-10T00:00:00.000Z",
    };
    expect(validateSchema("conversationRepositoryWorkCompletedEventPayload", payload).valid).toBe(
      true,
    );
    const legacyPayload = { ...payload } as Partial<typeof payload>;
    delete legacyPayload.requestedModel;
    delete legacyPayload.requestedReasoningEffort;
    delete legacyPayload.executionProfile;
    delete legacyPayload.allocationReason;
    delete legacyPayload.checkpointDisposition;
    expect(
      validateSchema("conversationRepositoryWorkCompletedEventPayload", legacyPayload).valid,
    ).toBe(true);
    expect(
      validateSchema("conversationRepositoryWorkCompletedEventPayload", {
        ...payload,
        requestedReasoningEffort: "extreme",
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("conversationRepositoryWorkCompletedEventPayload", {
        ...payload,
        repositoryRevisionAfter: payload.repositoryRevisionBefore,
        changedPaths: [],
        changedPathCount: 0,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("conversationRepositoryWorkCompletedEventPayload", {
        ...payload,
        knowledgeDisposition: "pending_background",
        sourceManifestContentHash: hash,
        sourceManifestByteCount: 256,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("conversationRepositoryWorkCompletedEventPayload", {
        ...payload,
        knowledgeDisposition: "pending_background",
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("conversationRepositoryWorkCompletedEventPayload", {
        ...payload,
        knowledgeDisposition: "not_applicable",
        repositoryRevisionAfter: payload.repositoryRevisionBefore,
        changedPaths: [],
        changedPathCount: 0,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("conversationRepositoryWorkCompletedEventPayload", {
        ...payload,
        knowledgeDisposition: "not_applicable",
      }).valid,
    ).toBe(false);
    expect(
      validateSchema(
        "event",
        envelope({
          schemaVersion: 2,
          type: "conversation.repository_work.completed",
          actor: { kind: "agent", provider: "codex" },
          payload,
        }),
      ).valid,
    ).toBe(true);
    expect(
      validateSchema(
        "event",
        envelope({
          schemaVersion: 1,
          type: "conversation.repository_work.completed",
          actor: { kind: "agent", provider: "codex" },
          payload,
        }),
      ).valid,
    ).toBe(false);
  });

  it("admits privacy-bounded repository-knowledge outcomes only on v3 readers", () => {
    const payload = {
      completionEventId: "evt_completion01",
      completionEventHash: hash,
      sourceConversationEventId: `cve_${"b".repeat(64)}`,
      jobId: `kjb_${"c".repeat(24)}`,
      agentId: `agt_${"d".repeat(24)}`,
      sourceManifest: { kind: "legacy_unavailable" },
      terminalState: "attention_required",
      attemptCount: 3,
      failureCode: "legacy_source_unavailable",
      knowledgeSnapshotHash: null,
      resolvedAt: "2026-09-23T00:00:00.000Z",
    };
    expect(
      validateSchema("conversationRepositoryKnowledgeResolvedEventPayload", payload).valid,
    ).toBe(true);
    expect(
      validateSchema("conversationRepositoryKnowledgeResolvedEventPayload", {
        ...payload,
        terminalState: "current",
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("conversationRepositoryKnowledgeResolvedEventPayload", {
        ...payload,
        terminalState: "current",
        failureCode: null,
        knowledgeSnapshotHash: hash,
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("conversationRepositoryKnowledgeResolvedEventPayload", {
        ...payload,
        sourceManifest: { kind: "content_bound", contentHash: hash, byteCount: 256 },
        terminalState: "current",
        failureCode: null,
        knowledgeSnapshotHash: hash,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 3, type: "conversation.repository_knowledge.resolved" }),
        payload,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 2, type: "conversation.repository_knowledge.resolved" }),
        payload,
      }).valid,
    ).toBe(false);
  });

  it("keeps managed provider-process observations bounded and unavailable to v1", () => {
    const payload = {
      adapterId: "lervo/codex",
      providerSessionDigest: hash,
      phase: "session_started",
      status: "running",
      evidence: "owned_process_state",
      observedAt: "2026-09-05T00:00:00.000Z",
      releasesAgentAuthority: false,
      releasesAssignmentAuthority: false,
      provesWorkProgress: false,
    };
    expect(validateSchema("providerProcessObservedEventPayload", payload).valid).toBe(true);
    expect(
      validateSchema("providerProcessObservedEventPayload", {
        ...payload,
        status: "unobservable",
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 2, type: "provider.process.observed" }),
        payload,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 1, type: "provider.process.observed" }),
        payload,
      }).valid,
    ).toBe(false);
  });

  it("keeps exact role-profile activation evidence unavailable to v1 envelopes", () => {
    const payload = {
      activationId: `rpact_${"b".repeat(24)}`,
      provider: "claude",
      roleId: "evidence-developer",
      roleVersion: "1.0.0",
      roleContractHash: hash,
      roleProfileHash: hash,
      runtimeProfileHash: hash,
      sourceKind: "repository",
      activatedAt: "2026-09-06T00:00:00.000Z",
    };
    expect(validateSchema("roleProfileActivatedEventPayload", payload).valid).toBe(true);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 2, type: "role.profile.activated" }),
        payload,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("event", {
        ...envelope({ schemaVersion: 1, type: "role.profile.activated" }),
        payload,
      }).valid,
    ).toBe(false);
  });

  it("accepts explicit handoff acknowledgement without treating it as provider telemetry", () => {
    expect(
      validateSchema(
        "event",
        envelope({
          type: "assignment.handoff.acknowledged",
          payload: {
            assignmentId: `asn_${"b".repeat(24)}`,
            handoffId: `hnd_${"c".repeat(24)}`,
            recipientAgentId: `agt_${"d".repeat(24)}`,
            acknowledgedAt: "2026-09-05T00:03:00.000Z",
            assignmentRevision: 4,
          },
        }),
      ).valid,
    ).toBe(true);
  });

  it("validates the new payload status and execution-mode discriminators", () => {
    const usage = {
      workId: `wrk_${"b".repeat(24)}`,
      resourceObservationId: `ruo_${"c".repeat(24)}`,
      sourceCoordinateDigest: hash,
      scope: "primary_provider",
      source: "provider_reported",
      accountingMode: "turn_cumulative",
      accountingDescriptorHash: hash,
      modelIdentity: {
        provider: "codex",
        requestedModel: null,
        answerModel: null,
        observedModelIds: [],
        answerModelEvidence: "unavailable",
        unavailableReason: "provider_model_unavailable",
      },
      status: "unavailable",
      usage: null,
      reasonCode: "provider_counter_missing",
    };
    expect(validateSchema("resourceUsageRecordedEventPayload", usage).valid).toBe(true);
    expect(
      validateSchema("resourceUsageRecordedEventPayload", { ...usage, reasonCode: null }).valid,
    ).toBe(false);

    const stages = {
      executionMode: "managed",
      workId: `wrk_${"b".repeat(24)}`,
      terminalObservationId: null,
      terminalHook: null,
      observationSetId: `stgobs_${"d".repeat(24)}`,
      stageCatalogVersion: 1,
      environmentProfileDigest: hash,
      repositoryProfile: "small",
      stages: [
        {
          stageId: "total",
          parentStageId: null,
          durationMs: 12.5,
          budgetMs: null,
          outcome: "completed",
          coldState: "unknown",
        },
      ],
    };
    expect(validateSchema("executionStagesObservedEventPayload", stages).valid).toBe(true);
    const legacyStages = { ...stages } as Record<string, unknown>;
    delete legacyStages.terminalHook;
    expect(validateSchema("executionStagesObservedEventPayload", legacyStages).valid).toBe(true);
    expect(
      validateSchema("executionStagesObservedEventPayload", {
        ...legacyStages,
        executionMode: "unmanaged_terminal",
        workId: null,
        terminalObservationId: "tobs_terminal_01",
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("executionStagesObservedEventPayload", {
        ...stages,
        terminalObservationId: "tobs_terminal_01",
        terminalHook: "Stop",
      }).valid,
    ).toBe(false);
  });

  it("discriminates the default and activated writer coordinates", () => {
    const base = {
      schemaVersion: 1,
      projectId: "prj_compatibility_01",
    };
    expect(
      validateSchema("eventWriterCoordinate", {
        ...base,
        selectedEventSchemaVersion: 1,
        activationEvidence: null,
      }).valid,
    ).toBe(true);
    const activationEvidence = {
      activationId: `evact_${"b".repeat(24)}`,
      observedAt: "2026-09-01T00:00:00.000Z",
      configurationHash: hash,
      readers: [
        {
          readerId: "reader_local_runtime",
          readerKind: "local",
          peerIdentityHash: null,
          capabilities: {
            schemaVersion: 1,
            capability: "event_reader",
            readableEventSchemaVersions: [1, 2],
          },
        },
      ],
    };
    expect(
      validateSchema("eventWriterCoordinate", {
        ...base,
        selectedEventSchemaVersion: 2,
        activationEvidence,
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("eventWriterCoordinate", {
        ...base,
        selectedEventSchemaVersion: 2,
        activationEvidence: null,
      }).valid,
    ).toBe(false);
  });
});

it("reserves context-quality events for schema 6", () => {
  for (const type of ["context.quality.prepared", "context.quality.verified"])
    for (const schemaVersion of [1, 2, 3, 4, 5, 6])
      expect(validateSchema("event", envelope({ type, schemaVersion })).valid).toBe(
        schemaVersion === 6,
      );
});
