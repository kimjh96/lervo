import {
  ManagedLinkedEvidenceCanaryError,
  managedLinkedEvidenceCanaryPolicy,
  managedLinkedEvidenceSelectionProtocolDigest,
  type ManagedLinkedEvidenceCanaryFailureCode,
  type ManagedLinkedEvidenceCanaryProjection,
} from "@lervo/context";
import {
  createManagedLinkedEvidenceCanaryRecord,
  LocalManagedLinkedEvidenceCanaryStore,
  type ManagedLinkedEvidenceUsageTotals,
} from "@lervo/search-local";
import type { ContextEvidence } from "@lervo/schemas";

import {
  managedLinkedEvidenceDigest,
  type ManagedLinkedEvidenceCanaryOutcome,
} from "./managed-linked-evidence-canary-contract.js";

export async function recordManagedLinkedEvidenceSelectionFailure(input: {
  repositoryRoot: string;
  authorization: ManagedLinkedEvidenceCanaryOutcome["authorization"];
  projection: ManagedLinkedEvidenceCanaryProjection;
  adapterReceiptId: string | null;
  durationMs: number;
  usage: ManagedLinkedEvidenceUsageTotals | null;
  failureCode: ManagedLinkedEvidenceCanaryFailureCode;
  recordedAt: Date;
}): Promise<void> {
  const emptyDigest = managedLinkedEvidenceDigest([]);
  const store = await LocalManagedLinkedEvidenceCanaryStore.open(input.repositoryRoot);
  try {
    await store.record(
      createManagedLinkedEvidenceCanaryRecord({
        canaryId: input.authorization.canaryId,
        projectId: input.authorization.projectId,
        runId: input.authorization.runId,
        providerArm: input.authorization.provider,
        sourceSnapshotId: input.projection.sourceSnapshotId,
        recommendationBatchId: input.authorization.recommendationBatchId,
        selectionAttemptId: input.authorization.selectionAttemptId,
        selectionPolicy: {
          kind: "provider_turn",
          policyId: managedLinkedEvidenceCanaryPolicy.selectionProtocolId,
          policyDigest: managedLinkedEvidenceSelectionProtocolDigest,
        },
        adapterReceiptId: input.adapterReceiptId,
        contextDeliveryId: null,
        candidateCount: input.projection.candidates.length,
        selectedCount: 0,
        loadedCount: 0,
        injectedCount: 0,
        referencedCount: 0,
        candidateDigest: managedLinkedEvidenceDigest(
          input.projection.candidates.map(({ documentId, contentHash }) => ({
            documentId,
            contentHash,
          })),
        ),
        selectedDigest: emptyDigest,
        loadedDigest: emptyDigest,
        injectedDigest: emptyDigest,
        referencedDigest: emptyDigest,
        candidateBytes: input.projection.providerVisibleSourceBytes,
        selectionProviderVisibleBytes: input.projection.providerVisibleSourceBytes,
        selectedBytes: 0,
        loadedBytes: 0,
        injectedBytes: 0,
        durationMs: input.durationMs,
        usage: input.usage,
        status: "failed",
        failureCode: input.failureCode,
        recordedAt: input.recordedAt.toISOString(),
      }),
    );
  } catch (error) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_storage_failed",
      "The failed managed linked-evidence selection record could not be stored.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

function evidenceDigest(evidence: readonly ContextEvidence[]): string {
  return managedLinkedEvidenceDigest(
    evidence.map((item) => ({
      documentId: item.documentId,
      contentHash: "contentHash" in item ? item.contentHash : null,
    })),
  );
}

export async function recordManagedLinkedEvidenceCanaryCompletion(input: {
  repositoryRoot: string;
  outcome: ManagedLinkedEvidenceCanaryOutcome;
  evidence: readonly ContextEvidence[];
  recordedAt: Date;
}): Promise<void> {
  const selectedIds = new Set(input.outcome.selections.map((item) => item.documentId));
  const selectedEvidence = input.evidence.filter(
    (item) => selectedIds.has(item.documentId) && item.state === "selected",
  );
  const loaded = input.evidence.filter(
    (item) => selectedIds.has(item.documentId) && item.state === "loaded",
  );
  const injected = input.evidence.filter(
    (item) => selectedIds.has(item.documentId) && item.state === "injected",
  );
  const referenced = input.evidence.filter(
    (item) => selectedIds.has(item.documentId) && item.state === "referenced",
  );
  const expectedHashes = new Map(
    input.outcome.selections.map((item) => [item.documentId, item.contentHash]),
  );
  const exactVersions = [...loaded, ...injected, ...referenced].every(
    (item) => "contentHash" in item && expectedHashes.get(item.documentId) === item.contentHash,
  );
  const deliveryIds = new Set(
    (input.outcome.selections.length === 0
      ? input.evidence.filter((item) => item.state === "injected")
      : injected
    ).flatMap((item) => ("adapterReceiptId" in item ? [item.adapterReceiptId] : [])),
  );
  if (
    selectedEvidence.length < input.outcome.selections.length ||
    loaded.length !== input.outcome.selections.length ||
    injected.length !== input.outcome.selections.length ||
    !exactVersions ||
    deliveryIds.size !== 1
  ) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_evidence_incomplete",
      "The selected, loaded, and injected managed canary evidence is incomplete.",
    );
  }
  const store = await LocalManagedLinkedEvidenceCanaryStore.open(input.repositoryRoot);
  try {
    await store.record(
      createManagedLinkedEvidenceCanaryRecord({
        canaryId: input.outcome.authorization.canaryId,
        projectId: input.outcome.authorization.projectId,
        runId: input.outcome.authorization.runId,
        providerArm: input.outcome.authorization.provider,
        sourceSnapshotId: input.outcome.sourceSnapshotId,
        recommendationBatchId: input.outcome.authorization.recommendationBatchId,
        selectionAttemptId: input.outcome.authorization.selectionAttemptId,
        selectionPolicy: input.outcome.selectionPolicy,
        adapterReceiptId: input.outcome.adapterReceiptId,
        contextDeliveryId: [...deliveryIds][0]!,
        candidateCount: input.outcome.candidates.length,
        selectedCount: input.outcome.selections.length,
        loadedCount: loaded.length,
        injectedCount: injected.length,
        referencedCount: referenced.length,
        candidateDigest: input.outcome.candidateDigest,
        selectedDigest: input.outcome.selectedDigest,
        loadedDigest: evidenceDigest(loaded),
        injectedDigest: evidenceDigest(injected),
        referencedDigest: evidenceDigest(referenced),
        candidateBytes: input.outcome.providerVisibleBytes,
        selectionProviderVisibleBytes: input.outcome.selectionProviderVisibleBytes,
        selectedBytes: input.outcome.selectedBytes,
        loadedBytes: loaded.reduce(
          (total, item) => total + ("byteCount" in item ? item.byteCount : 0),
          0,
        ),
        injectedBytes: loaded.reduce(
          (total, item) => total + ("byteCount" in item ? item.byteCount : 0),
          0,
        ),
        durationMs: input.outcome.durationMs,
        usage: input.outcome.usage,
        status: "completed",
        failureCode: null,
        recordedAt: input.recordedAt.toISOString(),
      }),
    );
  } catch (error) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_storage_failed",
      "The managed linked-evidence canary record could not be stored.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export async function recordManagedLinkedEvidenceCanaryFailure(input: {
  repositoryRoot: string;
  outcome: ManagedLinkedEvidenceCanaryOutcome;
  recordedAt: Date;
  failureCode?: "canary_selection_unavailable" | "canary_delivery_unconfirmed";
}): Promise<void> {
  const emptyDigest = managedLinkedEvidenceDigest([]);
  const store = await LocalManagedLinkedEvidenceCanaryStore.open(input.repositoryRoot);
  try {
    await store.record(
      createManagedLinkedEvidenceCanaryRecord({
        canaryId: input.outcome.authorization.canaryId,
        projectId: input.outcome.authorization.projectId,
        runId: input.outcome.authorization.runId,
        providerArm: input.outcome.authorization.provider,
        sourceSnapshotId: input.outcome.sourceSnapshotId,
        recommendationBatchId: input.outcome.authorization.recommendationBatchId,
        selectionAttemptId: input.outcome.authorization.selectionAttemptId,
        selectionPolicy: input.outcome.selectionPolicy,
        adapterReceiptId: input.outcome.adapterReceiptId,
        contextDeliveryId: null,
        candidateCount: input.outcome.candidates.length,
        selectedCount: input.outcome.selections.length,
        loadedCount: 0,
        injectedCount: 0,
        referencedCount: 0,
        candidateDigest: input.outcome.candidateDigest,
        selectedDigest: input.outcome.selectedDigest,
        loadedDigest: emptyDigest,
        injectedDigest: emptyDigest,
        referencedDigest: emptyDigest,
        candidateBytes: input.outcome.providerVisibleBytes,
        selectionProviderVisibleBytes: input.outcome.selectionProviderVisibleBytes,
        selectedBytes: input.outcome.selectedBytes,
        loadedBytes: 0,
        injectedBytes: 0,
        durationMs: input.outcome.durationMs,
        usage: input.outcome.usage,
        status: "failed",
        failureCode: input.failureCode ?? "canary_delivery_unconfirmed",
        recordedAt: input.recordedAt.toISOString(),
      }),
    );
  } catch (error) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_storage_failed",
      "The failed managed linked-evidence canary record could not be stored.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
