import { createHash } from "node:crypto";

import {
  createManagedWriteDecision,
  inspectTurnResultBinding,
  type ProviderAdapter,
} from "@lervo/adapter-contract";
import {
  ManagedLinkedEvidenceCanaryError,
  managedLinkedEvidenceCanaryPolicy,
  managedLinkedEvidenceSelectionProtocol,
  managedLinkedEvidenceSelectionProtocolDigest,
  managedLinkedEvidenceSelectionSchema,
  parseManagedLinkedEvidenceSelection,
  type GraphDocumentRecommendation,
  type ManagedLinkedEvidenceCanaryCandidate,
} from "@lervo/context";
import type { SearchRecommendationBatch } from "@lervo/search";
import { type ManagedLinkedEvidenceUsageTotals } from "@lervo/search-local";
import type {
  AdapterContextEnvelope,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";

import {
  assertManagedLinkedEvidenceSelectionBoundary,
  managedLinkedEvidenceDigest,
  type ManagedLinkedEvidenceAdapterFactory,
  type ManagedLinkedEvidenceCanaryAuthorization,
  type ManagedLinkedEvidenceCanaryOutcome,
  type ManagedLinkedEvidenceProvider,
} from "./managed-linked-evidence-canary-contract.js";
import {
  assertManagedLinkedEvidenceAuthorization,
  prepareManagedLinkedEvidenceProjection,
} from "./managed-linked-evidence-canary-projection.js";
import {
  recordManagedLinkedEvidenceCanaryFailure,
  recordManagedLinkedEvidenceSelectionFailure,
} from "./managed-linked-evidence-canary-record.js";

export type {
  ManagedLinkedEvidenceCanaryAuthorization,
  ManagedLinkedEvidenceCanaryOutcome,
} from "./managed-linked-evidence-canary-contract.js";

function protocolDocument() {
  const content = managedLinkedEvidenceSelectionProtocol;
  return {
    documentId: "doc_linked_evidence_managed_canary_protocol_v1",
    path: ".lervo/protocols/linked-evidence-managed-canary-v1.md",
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    byteCount: Buffer.byteLength(content),
    scope: { kind: "full" as const },
    documentRole: "governance_context" as const,
    referenceEligible: false,
    delivery: { kind: "inline" as const, content },
  };
}

function candidateDocument(candidate: ManagedLinkedEvidenceCanaryCandidate) {
  return {
    documentId: candidate.documentId,
    path: candidate.path,
    contentHash: candidate.contentHash,
    byteCount: candidate.byteCount,
    scope: { kind: "full" as const },
    documentRole: "task_evidence" as const,
    referenceEligible: true,
    delivery: { kind: "inline" as const, content: candidate.text },
  };
}

function usageFrom(event: AdapterNormalizedEvent): ManagedLinkedEvidenceUsageTotals | null {
  if (event.type !== "provider.usage.updated") return null;
  const values = [
    event.payload.inputTokens,
    event.payload.cachedInputTokens,
    event.payload.outputTokens,
    event.payload.reasoningOutputTokens,
    event.payload.totalTokens,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || Number(value) < 0)) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_evidence_incomplete",
      "The managed canary provider usage totals are invalid.",
    );
  }
  return {
    inputTokens: Number(event.payload.inputTokens),
    cachedInputTokens: Number(event.payload.cachedInputTokens),
    outputTokens: Number(event.payload.outputTokens),
    reasoningOutputTokens: Number(event.payload.reasoningOutputTokens),
    totalTokens: Number(event.payload.totalTokens),
  };
}

async function waitForSelection(input: {
  adapter: ProviderAdapter;
  session: AdapterSession;
  turn: AdapterTurn;
  timeoutMs: number;
}): Promise<ManagedLinkedEvidenceUsageTotals> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let usage: ManagedLinkedEvidenceUsageTotals | null = null;
  const terminal = (async () => {
    for await (const event of input.adapter.events(input.session, controller.signal)) {
      usage = usageFrom(event) ?? usage;
      if (
        event.type === "provider.command.executed" ||
        event.type === "provider.file_change.reported" ||
        event.type === "provider.error"
      ) {
        throw new ManagedLinkedEvidenceCanaryError(
          "canary_selection_unavailable",
          "The managed canary selection emitted a forbidden provider signal.",
        );
      }
      if (
        event.type === "provider.turn.failed" &&
        event.payload.providerTurnId === input.turn.providerTurnId
      ) {
        throw new ManagedLinkedEvidenceCanaryError(
          "canary_selection_unavailable",
          "The managed canary selection turn failed.",
        );
      }
      if (
        event.type === "provider.turn.completed" &&
        event.payload.providerTurnId === input.turn.providerTurnId
      ) {
        if (event.payload.status !== "completed" || usage === null) {
          throw new ManagedLinkedEvidenceCanaryError(
            "canary_evidence_incomplete",
            "The managed canary selection has no complete terminal usage evidence.",
          );
        }
        return usage;
      }
    }
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_selection_unavailable",
      "The managed canary provider stream ended before completion.",
    );
  })();
  try {
    return await Promise.race([
      terminal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ManagedLinkedEvidenceCanaryError(
                "canary_selection_unavailable",
                "The managed canary selection timed out.",
              ),
            ),
          input.timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    void terminal.catch(() => undefined);
  }
}

export async function executeManagedLinkedEvidenceCanary(input: {
  repositoryRoot: string;
  projectId: string;
  runId: string;
  provider: ManagedLinkedEvidenceProvider;
  request: string;
  authorization: ManagedLinkedEvidenceCanaryAuthorization;
  operationalBatch: SearchRecommendationBatch;
  recommendationBatches: readonly SearchRecommendationBatch[];
  graphRecommendations: readonly GraphDocumentRecommendation[];
  resolveArtifact: (uri: string) => Promise<Uint8Array>;
  createAdapter: ManagedLinkedEvidenceAdapterFactory;
  now: () => Date;
  timeoutMs?: number;
}): Promise<ManagedLinkedEvidenceCanaryOutcome> {
  assertManagedLinkedEvidenceAuthorization({
    authorization: input.authorization,
    projectId: input.projectId,
    runId: input.runId,
    provider: input.provider,
    recommendationBatchId: input.operationalBatch.batchId,
  });
  const projection = await prepareManagedLinkedEvidenceProjection(input);
  assertManagedLinkedEvidenceAuthorization({
    authorization: input.authorization,
    projectId: input.projectId,
    runId: input.runId,
    provider: input.provider,
    recommendationBatchId: input.operationalBatch.batchId,
    sourceSnapshotId: projection.sourceSnapshotId,
  });
  const adapter = input.createAdapter({
    provider: input.provider,
    repositoryRoot: input.repositoryRoot,
    resolveArtifact: input.resolveArtifact,
    structuredOutputSchema: managedLinkedEvidenceSelectionSchema(projection.candidates),
    selectionBoundary: "read_only_no_tools",
  });
  const requestedAt = input.now().toISOString();
  const sessionId = `ses_${createHash("sha256").update(input.authorization.selectionAttemptId).digest("hex").slice(0, 24)}`;
  const targetTurnId = `turn_${createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`;
  const started = Date.now();
  let session: AdapterSession | undefined;
  let stopReason: "completed" | "failed" = "failed";
  let selectionAdapterReceiptId: string | null = null;
  let selectionUsage: ManagedLinkedEvidenceUsageTotals | null = null;
  let outcome: ManagedLinkedEvidenceCanaryOutcome | undefined;
  let stopFailure: Error | undefined;
  try {
    session = await adapter.start({
      kind: "start_request",
      schemaVersion: 1,
      adapterId: adapter.descriptor.adapterId,
      projectId: input.projectId,
      runId: input.runId,
      sessionId,
      roleId: "retrieval-canary",
      writingPolicyId: null,
      requestDigest: managedLinkedEvidenceDigest(input.request),
      executionMode: "read_only",
      requestedAt,
    });
    assertManagedLinkedEvidenceSelectionBoundary(session);
    const envelope: AdapterContextEnvelope = {
      kind: "context_envelope",
      schemaVersion: 1,
      envelopeId: `envelope_${createHash("sha256").update(targetTurnId).digest("hex").slice(0, 24)}`,
      adapterId: adapter.descriptor.adapterId,
      projectId: input.projectId,
      runId: input.runId,
      sessionId,
      roleId: "retrieval-canary",
      writingPolicyId: null,
      writingPolicyDocumentId: null,
      targetTurnId,
      contextGeneration: 0,
      documents: [protocolDocument(), ...projection.candidates.map(candidateDocument)],
      createdAt: input.now().toISOString(),
    };
    const receipt = await adapter.injectContext(session, envelope);
    selectionAdapterReceiptId = receipt.receiptId;
    const expected = new Map(envelope.documents.map((document) => [document.documentId, document]));
    if (
      receipt.controlledInput !== true ||
      receipt.providerSessionId !== session.providerSessionId ||
      receipt.targetTurnId !== targetTurnId ||
      receipt.documents.length !== expected.size ||
      receipt.documents.some(
        (document) =>
          document.status !== "injected" ||
          expected.get(document.documentId)?.contentHash !== document.contentHash ||
          expected.get(document.documentId)?.documentRole !== document.documentRole ||
          expected.get(document.documentId)?.referenceEligible !== document.referenceEligible,
      )
    ) {
      throw new ManagedLinkedEvidenceCanaryError(
        "canary_delivery_unconfirmed",
        "The selection adapter did not confirm the exact candidate envelope.",
      );
    }
    await adapter.attachManagedWriteBridge(session, {
      authorize: async (request) =>
        createManagedWriteDecision({
          request,
          decision: "deny",
          reasonCode: "capability_denied",
          decidedAt: input.now().toISOString(),
        }),
      complete: async () => {
        throw new ManagedLinkedEvidenceCanaryError(
          "canary_selection_unavailable",
          "The read-only selection attempted a managed write.",
        );
      },
    });
    let accepted: AdapterTurn | undefined;
    const turn = await adapter.startTurn(
      session,
      {
        kind: "turn_request",
        schemaVersion: 1,
        adapterId: adapter.descriptor.adapterId,
        projectId: input.projectId,
        runId: input.runId,
        sessionId,
        providerSessionId: session.providerSessionId,
        targetTurnId,
        instructions: input.request,
        requestedAt: input.now().toISOString(),
      },
      (value) => {
        accepted = structuredClone(value);
      },
    );
    if (accepted === undefined || JSON.stringify(accepted) !== JSON.stringify(turn)) {
      throw new ManagedLinkedEvidenceCanaryError(
        "canary_selection_unavailable",
        "The selection adapter did not report one exact accepted turn.",
      );
    }
    const usage = await waitForSelection({
      adapter,
      session,
      turn,
      timeoutMs: input.timeoutMs ?? 20 * 60 * 1000,
    });
    selectionUsage = usage;
    const result = await adapter.getTurnResult(session, turn);
    if (!inspectTurnResultBinding({ session, turn, result }).passed) {
      throw new ManagedLinkedEvidenceCanaryError(
        "canary_selection_invalid",
        "The managed canary result does not match the accepted turn.",
      );
    }
    const selections = parseManagedLinkedEvidenceSelection({
      content: result.content,
      candidates: projection.candidates,
      selectionAttemptId: input.authorization.selectionAttemptId,
    });
    const selectedById = new Map(projection.candidates.map((item) => [item.documentId, item]));
    stopReason = "completed";
    outcome = {
      authorization: structuredClone(input.authorization),
      selections,
      candidates: structuredClone(projection.candidates),
      sourceSnapshotId: projection.sourceSnapshotId,
      candidateDigest: managedLinkedEvidenceDigest(
        projection.candidates.map(({ documentId, contentHash }) => ({ documentId, contentHash })),
      ),
      selectedDigest: managedLinkedEvidenceDigest(
        selections.map(({ documentId, contentHash }) => ({ documentId, contentHash })),
      ),
      providerVisibleBytes: projection.providerVisibleSourceBytes,
      selectedBytes: selections.reduce(
        (total, selection) => total + selectedById.get(selection.documentId)!.byteCount,
        0,
      ),
      selectionProviderVisibleBytes: projection.providerVisibleSourceBytes,
      selectionPolicy: {
        kind: "provider_turn",
        policyId: managedLinkedEvidenceCanaryPolicy.selectionProtocolId,
        policyDigest: managedLinkedEvidenceSelectionProtocolDigest,
      },
      adapterReceiptId: receipt.receiptId,
      durationMs: Date.now() - started,
      usage,
    };
  } catch (error) {
    const failure =
      error instanceof ManagedLinkedEvidenceCanaryError
        ? error
        : new ManagedLinkedEvidenceCanaryError(
            "canary_selection_unavailable",
            "The managed linked-evidence selection call was unavailable.",
            { cause: error instanceof Error ? error : undefined },
          );
    await recordManagedLinkedEvidenceSelectionFailure({
      repositoryRoot: input.repositoryRoot,
      authorization: input.authorization,
      projection,
      adapterReceiptId: selectionAdapterReceiptId,
      durationMs: Date.now() - started,
      usage: selectionUsage,
      failureCode: failure.code,
      recordedAt: input.now(),
    });
    throw failure;
  } finally {
    if (session !== undefined) {
      try {
        await adapter.stop(session, {
          kind: "stop_request",
          schemaVersion: 1,
          adapterId: adapter.descriptor.adapterId,
          projectId: input.projectId,
          runId: input.runId,
          sessionId,
          providerSessionId: session.providerSessionId,
          reason: stopReason,
          requestedAt: input.now().toISOString(),
        });
      } catch (error) {
        if (stopReason === "completed") {
          stopFailure = new ManagedLinkedEvidenceCanaryError(
            "canary_selection_unavailable",
            "The managed canary selection session could not stop cleanly.",
            { cause: error instanceof Error ? error : undefined },
          );
        }
      }
    }
  }
  if (stopFailure !== undefined) {
    if (outcome !== undefined) {
      await recordManagedLinkedEvidenceCanaryFailure({
        repositoryRoot: input.repositoryRoot,
        outcome,
        recordedAt: input.now(),
        failureCode: "canary_selection_unavailable",
      });
    }
    throw stopFailure;
  }
  if (outcome === undefined) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_evidence_incomplete",
      "The managed canary selection completed without an outcome.",
    );
  }
  return outcome;
}

export {
  recordManagedLinkedEvidenceCanaryCompletion,
  recordManagedLinkedEvidenceCanaryFailure,
} from "./managed-linked-evidence-canary-record.js";
