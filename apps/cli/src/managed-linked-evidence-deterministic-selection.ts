import {
  ManagedLinkedEvidenceCanaryError,
  managedLinkedEvidenceDeterministicSelectionPolicy,
} from "@lervo/context";
import type { SearchRecommendationBatch } from "@lervo/search";

import {
  managedLinkedEvidenceCanonicalDigest,
  managedLinkedEvidenceDigest,
  type ManagedLinkedEvidenceCanaryOutcome,
  type ManagedLinkedEvidenceDeterministicSelectionAuthorization,
  type ManagedLinkedEvidenceProvider,
} from "./managed-linked-evidence-canary-contract.js";
import {
  assertManagedLinkedEvidenceAuthorization,
  prepareManagedLinkedEvidenceProjection,
} from "./managed-linked-evidence-canary-projection.js";

export async function resolveDeterministicManagedLinkedEvidenceSelection(input: {
  repositoryRoot: string;
  projectId: string;
  runId: string;
  provider: ManagedLinkedEvidenceProvider;
  authorization: ManagedLinkedEvidenceDeterministicSelectionAuthorization;
  operationalBatch: SearchRecommendationBatch;
  recommendationBatches: readonly SearchRecommendationBatch[];
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
  const selectedVersions = projection.candidates.map(({ documentId, contentHash }) => ({
    documentId,
    contentHash,
  }));
  if (
    projection.projectionDigest !==
      input.authorization.deterministicSelection.sourceProjectionDigest ||
    selectedVersions.length !==
      input.authorization.deterministicSelection.projectedSelectionCount ||
    managedLinkedEvidenceCanonicalDigest(selectedVersions) !==
      input.authorization.deterministicSelection.projectedSelectionDigest
  ) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_not_eligible",
      "The deterministic managed linked-evidence selection differs from its exact authorization.",
    );
  }
  const selections = projection.candidates.map((candidate, index) => ({
    schemaVersion: 1 as const,
    selectionAttemptId: input.authorization.selectionAttemptId,
    documentId: candidate.documentId,
    path: candidate.path,
    contentHash: candidate.contentHash,
    rank: index + 1,
  }));
  return {
    authorization: structuredClone(input.authorization),
    selections,
    candidates: structuredClone(projection.candidates),
    sourceSnapshotId: projection.sourceSnapshotId,
    candidateDigest: managedLinkedEvidenceDigest(selectedVersions),
    selectedDigest: managedLinkedEvidenceDigest(selectedVersions),
    providerVisibleBytes: projection.providerVisibleSourceBytes,
    selectedBytes: projection.providerVisibleSourceBytes,
    selectionProviderVisibleBytes: 0,
    selectionPolicy: {
      kind: "deterministic_policy",
      policyId: managedLinkedEvidenceDeterministicSelectionPolicy.policyId,
      policyDigest: managedLinkedEvidenceDeterministicSelectionPolicy.digest,
    },
    adapterReceiptId: null,
    durationMs: 0,
    usage: null,
  };
}
